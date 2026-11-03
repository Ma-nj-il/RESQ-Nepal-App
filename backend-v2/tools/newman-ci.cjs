// Emit only repository-owned test names, HTTP status and public error codes in annotations.
// Newman JSON reports contain session credentials and must not be uploaded as CI artifacts.
const newman = require('newman');
const path = require('node:path');

const escape = (value) =>
  String(value).replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');
const responses = new Map();
const collection = process.argv[2];
if (!collection) throw new Error('A collection path is required');

newman
  .run(
    {
      collection: path.resolve(collection),
      environment: path.resolve('postman/local.postman_environment.json'),
      reporters: ['cli'],
      bail: true,
    },
    (error, summary) => {
      if (error || summary?.run.failures.length) {
        for (const failure of summary?.run.failures ?? []) {
          const name = failure.source?.name ?? 'collection';
          const response = responses.get(failure.source?.id) ?? 'no HTTP response';
          console.log(
            `::error::${escape(`Newman ${name}: ${response}; assertion=${failure.error?.test ?? failure.error?.name ?? 'execution'}`)}`,
          );
        }
        if (error) console.log('::error::Newman could not complete the collection.');
        process.exitCode = 1;
      }
    },
  )
  .on('request', (error, args) => {
    let description = error ? 'transport error' : `HTTP ${args.response?.code}`;
    try {
      const code = args.response.json()?.error?.code;
      if (typeof code === 'string' && /^[A-Z0-9_.-]{1,80}$/.test(code))
        description += `; code=${code}`;
    } catch {
      /* Non-JSON bodies are never emitted. */
    }
    responses.set(args.item.id, description);
  });
