import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { ClerkWithRouter } from './auth/ClerkWithRouter';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false, retry: false } },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <ClerkWithRouter>
        <QueryClientProvider client={queryClient}>
          <App />
        </QueryClientProvider>
      </ClerkWithRouter>
    </BrowserRouter>
  </StrictMode>,
);
