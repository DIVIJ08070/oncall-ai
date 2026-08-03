import type { ReactNode } from 'react';
import { TopBar } from './TopBar';
import { SideNav } from './SideNav';
import { BottomTabBar } from './BottomTabBar';
import { CursorSpotlight } from './CursorSpotlight';

/**
 * App shell (DESIGN_SPEC §4): TopBar (sticky 56px) + SideNav + Content. Content is
 * `--bg`, max-width 1280 centered, padding 24/16/12 by tier; reserves a 56px bottom
 * offset on mobile for the tab bar.
 */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="relative flex min-h-screen flex-col bg-bg">
      <CursorSpotlight />
      {/* Content sits above the ambient glow layer. */}
      <div className="relative z-10 flex min-h-screen flex-col">
        <TopBar />
        <div className="flex flex-1">
          <SideNav />
          <main className="min-w-0 flex-1 pb-16 sm:pb-0">
            <div className="mx-auto w-full max-w-[1280px] p-3 sm:p-4 lg:p-6">
              {children}
            </div>
          </main>
        </div>
        <BottomTabBar />
      </div>
    </div>
  );
}
