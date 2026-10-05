// Lets Node run the app's TypeScript (see loader.mjs). Passed with --import,
// so worker threads started by the tests get it too.
import { register } from 'node:module';

register('./loader.mjs', import.meta.url);
