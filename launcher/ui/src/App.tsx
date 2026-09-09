import { useEffect, useState } from "react";
import TitleBar from "./components/TitleBar";
import AuthScreen from "./components/AuthScreen";
import ModSelectScreen from "./components/ModSelectScreen";
import LauncherScreen from "./components/LauncherScreen";
import SkinUploadScreen from "./components/SkinUploadScreen";
import SettingsScreen from "./components/SettingsScreen";
import Sidebar, { Screen as NavScreen } from "./components/Sidebar";
import UpdateModal from "./components/UpdateModal";
import { api, User } from "./api";

type Screen = "mods" | NavScreen;

interface UpdateInfo {
  latest: string;
  current: string;
  notes: string;
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [screen, setScreen] = useState<Screen>("mods");
  const [update, setUpdate] = useState<UpdateInfo | null>(null);

  useEffect(() => {
    api
      .currentUser()
      .then((u) => setUser(u))
      .catch(() => {})
      .finally(() => setLoading(false));

    // Проверка обновлений при старте: ошибка сети -> молча
    api
      .checkUpdates()
      .then((r) => {
        if (r.available) setUpdate({ latest: r.latest, current: r.current, notes: r.notes });
      })
      .catch(() => {});
  }, []);

  let content: JSX.Element;
  if (loading) {
    content = (
      <div className="h-full grid place-items-center">
        <div className="w-8 h-8 border-2 border-quasar-accent border-t-transparent rounded-full animate-spin" />
      </div>
    );
  } else if (!user) {
    content = <AuthScreen onAuth={setUser} />;
  } else {
    switch (screen) {
      case "play":
        content = (
          <LauncherScreen
            user={user}
            onLogout={async () => { await api.logout(); setUser(null); setScreen("mods"); }}
          />
        );
        break;
      case "skins":
        content = <SkinUploadScreen user={user} onBack={() => setScreen("play")} />;
        break;
      case "settings":
        content = <SettingsScreen user={user} onBack={() => setScreen("play")} />;
        break;
      default:
        content = (
          <ModSelectScreen
            key={user.userId}
            onContinue={() => setScreen("play")}
            onLogout={async () => { await api.logout(); setUser(null); }}
          />
        );
    }
  }

  const authorized = !loading && !!user && screen !== "mods";

  return (
    <div className="h-screen flex flex-col bg-quasar-bg overflow-hidden">
      <TitleBar />
      <div className="flex-1 min-h-0 flex">
        {authorized && <Sidebar screen={screen as NavScreen} onNavigate={setScreen} />}
        <div className="flex-1 min-w-0 relative">{content}</div>
      </div>
      {update && (
        <UpdateModal
          latest={update.latest}
          current={update.current}
          notes={update.notes}
          onClose={() => setUpdate(null)}
        />
      )}
    </div>
  );
}
