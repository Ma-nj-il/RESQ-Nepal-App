// postman-collection@4 expects Faker 5's CommonJS export and eagerly reads its legacy namespaces.
// Faker 5 has a high-severity code-injection advisory. Keep the patched Faker override and expose
// only enough of its modern API for Newman to load. Unsupported legacy dynamic variables fail when
// used; the versioned Gate 2 collection intentionally uses no Faker dynamic variables.
const fakerModulePath = require.resolve('@faker-js/faker/locale/en');
const fakerModule = require(fakerModulePath);
const faker = fakerModule.faker ?? fakerModule;

function unsupported(path) {
  return new Proxy(
    function unsupportedLegacyFakerApi() {
      throw new Error(`Unsupported legacy Postman dynamic variable generator: ${path}`);
    },
    {
      get(_target, property) {
        return unsupported(`${path}.${String(property)}`);
      },
    },
  );
}

function adapt(value, path, receiver) {
  if (typeof value === 'function') {
    return (...arguments_) => Reflect.apply(value, receiver, arguments_);
  }
  if (typeof value !== 'object' || value === null) return value;

  return new Proxy(value, {
    get(target, property) {
      if (!Reflect.has(target, property)) return unsupported(`${path}.${String(property)}`);
      return adapt(Reflect.get(target, property), `${path}.${String(property)}`, target);
    },
  });
}

const rootAliases = {
  address: faker.location,
  name: faker.person,
  random: faker.helpers,
};

require.cache[fakerModulePath].exports = new Proxy(faker, {
  get(target, property) {
    if (Object.hasOwn(rootAliases, property)) {
      const value = rootAliases[property];
      return adapt(value, `faker.${String(property)}`, value);
    }
    if (!Reflect.has(target, property)) return unsupported(`faker.${String(property)}`);
    return adapt(Reflect.get(target, property), `faker.${String(property)}`, target);
  },
});
