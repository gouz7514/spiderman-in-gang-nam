import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';

/**
 * Deliberately not wrapped in <StrictMode>: its double effect invocation would
 * fire two Overpass requests on a cold start and build the physics world twice.
 * Being a good citizen towards a free public API wins here.
 */
createRoot(document.getElementById('root')!).render(<App />);
