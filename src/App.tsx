import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import LandingPage from './components/LandingPage';
import Layout from './components/Layout';
import OtpVerifyScreen from './components/OtpVerifyScreen';
import NewPasswordScreen from './components/NewPasswordScreen';
import './App.css';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/chat" element={<Layout />} />
        <Route path="/chat/*" element={<Layout />} />
        {/* Auth sub-routes */}
        <Route path="/auth/verify-otp" element={<OtpVerifyScreen />} />
        <Route path="/auth/reset-password" element={<NewPasswordScreen />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
