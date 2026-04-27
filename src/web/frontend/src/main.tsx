import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import App from './App';
import { AppProvider } from './components/Layout/AppContext';
import './styles/index.css';

const isElectron = navigator.userAgent.includes('Electron');
const Router = isElectron ? HashRouter : BrowserRouter;

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Router>
      <AppProvider>
        <App />
      </AppProvider>
    </Router>
  </React.StrictMode>,
);
