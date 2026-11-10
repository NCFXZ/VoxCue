import ReactDOM from 'react-dom/client';
import { MobileApp } from './App';
import { createMobileConnection } from './connection';
import './styles.css';

const connection = createMobileConnection();
ReactDOM.createRoot(document.getElementById('root')!).render(<MobileApp connection={connection} />);
