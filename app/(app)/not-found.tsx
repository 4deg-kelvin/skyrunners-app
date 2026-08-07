/**
 * 404 for authenticated routes.
 *
 * Exists so that `notFound()` from e.g. a missing project slug renders inside
 * the app shell, with the nav bar and page container. Falling through to the
 * root `not-found.tsx` would show the card flush against the viewport with no
 * navigation, which looks broken even though the links work.
 */
export { default } from "../not-found";
