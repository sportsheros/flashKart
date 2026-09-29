import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { FlashSalePage } from './components/FlashSalePage';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <FlashSalePage />
  </StrictMode>,
);
