import { useEffect } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import Layout from './components/Layout';
import OtpVerifyScreen from './components/OtpVerifyScreen';
import NewPasswordScreen from './components/NewPasswordScreen';
import MarketingLayout from './components/MarketingLayout';
import HomePage from './pages/HomePage'; 
import AboutPage from './pages/AboutPage';
import ContactPage from './pages/ContactPage';
import PackagesPage from './pages/PackagesPage';
import LoginPage from './pages/Auth/LoginPage';
import SignupPage from './pages/Auth/SignupPage';
import TermsPage from './pages/TermsPage';
import PrivacyPage from './pages/PrivacyPage';
import RefundPage from './pages/RefundPage';
import { useAuthStore } from './store/authStore';
import './App.css';

function App() {
  const { initialize } = useAuthStore();

  useEffect(() => {
    initialize();
  }, [initialize]);

  return (
    <BrowserRouter>
      <Routes>
        <Route element={<MarketingLayout />}>
          <Route path="/" element={<HomePage />} />
          <Route path="/about" element={<AboutPage />} />
          <Route path="/contact" element={<ContactPage />} />
          <Route path="/packages" element={<PackagesPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/signup" element={<SignupPage />} />
          <Route path="/terms" element={<TermsPage />} />
          <Route path="/privacy" element={<PrivacyPage />} />
          <Route path="/refund" element={<RefundPage />} />
        </Route>
        
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
