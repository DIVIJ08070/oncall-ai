import { BrowserRouter } from 'react-router-dom';
import { SessionProvider } from './state/SessionContext';
import { LiveProvider } from './state/LiveContext';
import { AppRoutes } from './router';

/**
 * App root: providers (SessionContext per SPEC §6, LiveContext for the global
 * ConnectionStatus) wrapped around the router. Dark-first theme is applied
 * pre-paint in index.html and toggled from the SideNav footer.
 */
export function App() {
  return (
    <BrowserRouter>
      <SessionProvider>
        <LiveProvider>
          <AppRoutes />
        </LiveProvider>
      </SessionProvider>
    </BrowserRouter>
  );
}
