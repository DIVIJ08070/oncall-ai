import { Link } from 'react-router-dom';

/**
 * Landing brand mark: 2x2 grid of white dots + "OnCall AI" wordmark, used on the
 * full-screen orange brand surfaces (home / 404 / menu overlay). These surfaces
 * are brand-fixed (same in light and dark), so white is intentional here.
 */
export function BrandMark() {
  return (
    <Link to="/" className="flex items-center rounded-md">
      <span className="grid grid-cols-2 gap-0.5">
        <span className="h-2.5 w-2.5 rounded-full bg-white sm:h-3 sm:w-3" />
        <span className="h-2.5 w-2.5 rounded-full bg-white sm:h-3 sm:w-3" />
        <span className="h-2.5 w-2.5 rounded-full bg-white sm:h-3 sm:w-3" />
        <span className="h-2.5 w-2.5 rounded-full bg-white sm:h-3 sm:w-3" />
      </span>
      <span className="ml-1 text-lg font-bold text-white sm:text-xl">OnCall AI</span>
    </Link>
  );
}
