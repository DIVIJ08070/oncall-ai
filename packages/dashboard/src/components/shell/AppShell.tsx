import type { ReactNode } from 'react';
import { UnifiedSidebar, UnifiedTopBar } from './UnifiedChrome';
import { BottomTabBar } from './BottomTabBar';
import { CursorSpotlight } from './CursorSpotlight';
import { Grain, AtmosphereBackdrop, Scanlines, ScanSweep } from '../atmosphere';

/**
 * App shell (DESIGN_SPEC §4): TopBar (sticky 56px) + SideNav + Content. Content is
 * `--bg`, max-width 1280 centered, padding 24/16/12 by tier; reserves a 56px bottom
 * offset on mobile for the tab bar.
 */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="relative flex min-h-screen flex-col bg-bg">
      {/* Igloo-inspired atmosphere: aurora depth + HUD grid behind everything, film grain on top. */}
      <AtmosphereBackdrop />
      <Scanlines />
      <ScanSweep />
      <Grain />
      <CursorSpotlight />
      {/* Content sits above the ambient + atmosphere layers. */}
      <div className="relative z-10 flex w-full items-start gap-6 p-4 sm:p-6">
        <UnifiedSidebar />
        <main className="min-w-0 flex-1 pb-16 sm:pb-0">
          <UnifiedTopBar />
          <div className="mx-auto w-full max-w-[1280px]">{children}</div>
        </main>
      </div>
      <BottomTabBar />
    </div>
  );
}
