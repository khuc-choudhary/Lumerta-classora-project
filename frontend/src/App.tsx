import { useEffect, useRef } from "react";
import { Navigate, Outlet, Route, Routes } from "react-router-dom";
import History from "./pages/History";
import Pronunciation from "./pages/Pronunciation";
import Shell from "./components/Shell";
import { LoadingScreen } from "./components/ui";
import { Forgot, Login, Reset, Signup, Verify } from "./pages/Auth";
import Classroom from "./pages/Classroom";
import Dashboard from "./pages/Dashboard";
import Documents from "./pages/Documents";
import Landing from "./pages/Landing";
import Library from "./pages/Library";
import Onboarding from "./pages/Onboarding";
import Profile from "./pages/Profile";
import Studio from "./pages/Studio";
import Study from "./pages/Study";
import Themes from "./pages/Themes";
import { useApp } from "./store";

/** No login wall: visitors without a session silently get a guest account, so everything works immediately. */
function Protected() {
  const { user, loading, startGuest } = useApp();
  const started = useRef(false);
  useEffect(() => { if (!loading && !user && !started.current) { started.current = true; startGuest().finally(() => { started.current = false; }); } }, [loading, user, startGuest]);
  return user ? <Outlet /> : <LoadingScreen />;
}
function NeedsOnboarding() {
  const { user } = useApp();
  return user && !user.prefs.onboarded ? <Navigate to="/welcome" replace /> : <Shell />;
}

export default function App() {
  const { loading } = useApp();
  if (loading) return <LoadingScreen />;
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/login" element={<Login />} />
      <Route path="/signup" element={<Signup />} />
      <Route path="/forgot" element={<Forgot />} />
      <Route path="/reset" element={<Reset />} />
      <Route path="/verify" element={<Verify />} />
      <Route element={<Protected />}>
        <Route path="/welcome" element={<Onboarding />} />
        <Route path="/app" element={<NeedsOnboarding />}>
          <Route index element={<Dashboard />} />
          <Route path="classroom" element={<Classroom />} />
          <Route path="documents" element={<Documents />} />
          <Route path="study" element={<Study />} />
          <Route path="library" element={<Library />} />
          <Route path="history" element={<History />} />
          <Route path="studio" element={<Studio />} />
          <Route path="pronunciation" element={<Pronunciation />} />
          <Route path="themes" element={<Themes />} />
          <Route path="profile" element={<Profile />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
