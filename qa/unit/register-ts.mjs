// Registers a tiny resolver so Node can import the app's extensionless
// TypeScript modules in unit tests (Metro/TypeScript use extensionless imports).
import { register } from 'node:module';

register('./ts-resolve.mjs', import.meta.url);
