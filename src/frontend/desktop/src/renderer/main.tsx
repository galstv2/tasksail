import React from 'react';
import ReactDOM from 'react-dom/client';

import App from './App';
import { installRendererProcessHandlers } from './log/installRendererProcessHandlers';
import './styles/index.css';

installRendererProcessHandlers();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
