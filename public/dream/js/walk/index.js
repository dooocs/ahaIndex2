// Walking on a small planet: where you can stand (field), how you move (controller), in what shapes (shapes).
// Pure ES modules with no three.js dependency, so they run unchanged in the page and in `node --test`.
export { createWalkField } from './field.js';
export { createController } from './controller.js';
export * as shapes from './shapes.js';
