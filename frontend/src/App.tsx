import { BrowserRouter } from 'react-router-dom';
import { RoutedApp } from './app/routed-app';

function App() {
  return (
    <BrowserRouter>
      <RoutedApp />
    </BrowserRouter>
  );
}

export default App;
