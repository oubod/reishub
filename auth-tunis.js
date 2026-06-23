const TUNIS_AUTH = {
  url: "https://rsnbcgrtrjfvnoczildf.supabase.co",
  anonKey: "sb_publishable_x8DaZHPwJORpR2tE5eClMA_yUsD2NTD",
  table: "tunis_profiles",
  appPath: "tunis.html",
  loginPath: "login-tunis.html"
};

const tunisSupabase = window.supabase.createClient(TUNIS_AUTH.url, TUNIS_AUTH.anonKey);
window.tunisSupabase = tunisSupabase;

const authMessage = (message, type = "error") => {
  const node = document.getElementById("authMessage");
  if (!node) return;
  node.textContent = message;
  node.dataset.type = type;
  node.hidden = false;
};

const avatarFor = (username) =>
  `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(username || "FMT")}&backgroundColor=c1121f&textColor=FFFFFF&radius=50`;

const friendlyAuthError = (error) =>
  error && (error.status === 429 || /rate limit|too many/i.test(error.message || ""))
    ? "Trop de tentatives. Attendez une minute puis reessayez."
    : (error && error.message) || "Erreur Supabase.";

async function logUserSession(appKey, supabaseClientInstance) {
  try {
    const res = await fetch("https://ipapi.co/json/");
    if (!res.ok) throw new Error("IP fetch failed");
    const geo = await res.json();
    await supabaseClientInstance.rpc("log_user_login", {
      app_key: appKey,
      ip_address: geo.ip || "Unknown",
      latitude: geo.latitude ? parseFloat(geo.latitude) : null,
      longitude: geo.longitude ? parseFloat(geo.longitude) : null,
      user_agent: navigator.userAgent
    });
  } catch (err) {
    console.error("Failed to log session:", err);
    try {
      await supabaseClientInstance.rpc("log_user_login", {
        app_key: appKey,
        ip_address: "Unknown",
        latitude: null,
        longitude: null,
        user_agent: navigator.userAgent
      });
    } catch (e) {
      console.error("Fallback log failed:", e);
    }
  }
}

async function ensureTunisApprovedSession() {
  if (localStorage.getItem("portalGuest") === "tunis") {
    window.portalAuthUser = { id: "guest-tunis", email: "guest@local" };
    window.portalAuthProfile = {
      id: "guest-tunis",
      username: "Invite",
      avatar_url: avatarFor("Invite"),
      progress: {},
      approved: true,
      isGuest: true
    };
    return { session: null, profile: window.portalAuthProfile, guest: true };
  }

  const { data: { session } } = await tunisSupabase.auth.getSession();
  if (!session) {
    window.location.replace(`${TUNIS_AUTH.loginPath}?next=${encodeURIComponent(location.pathname.split("/").pop() || TUNIS_AUTH.appPath)}`);
    return null;
  }

  const { data: profile, error } = await tunisSupabase
    .from(TUNIS_AUTH.table)
    .select("*")
    .eq("id", session.user.id)
    .single();

  if (error || !profile || profile.rejected || !profile.approved) {
    await tunisSupabase.auth.signOut();
    window.location.replace(`${TUNIS_AUTH.loginPath}?${profile && profile.rejected ? "rejected" : "pending"}=1`);
    return null;
  }

  if (profile.suspended_until && new Date(profile.suspended_until) > new Date()) {
    await tunisSupabase.auth.signOut();
    window.location.replace(`${TUNIS_AUTH.loginPath}?suspended=1&until=${encodeURIComponent(profile.suspended_until)}`);
    return null;
  }

  window.portalAuthUser = session.user;
  window.portalAuthProfile = profile;
  logUserSession("tunisia", tunisSupabase);
  return { session, profile };
}

function safeNext(raw, fallback) {
  if (!raw) return fallback;
  try {
    const url = new URL(raw, location.href);
    if (url.origin !== location.origin) return fallback;
    return url.pathname + url.search + url.hash;
  } catch { return fallback; }
}

function setupTunisLogin() {
  const signin = document.getElementById("signinForm");
  const signup = document.getElementById("signupForm");
  const signinTab = document.getElementById("signinTab");
  const signupTab = document.getElementById("signupTab");
  const title = document.getElementById("authTitle");
  const subtitle = document.getElementById("authSubtitle");
  const guestButton = document.getElementById("guestButton");
  let mode = "signin";

  if (!signin || !signup || !signinTab || !signupTab || !title || !subtitle) {
    console.warn("Tunis auth screen is missing required elements.");
    return;
  }

  const params = new URLSearchParams(location.search);
  if (params.get("pending") === "1") {
    authMessage("Votre compte existe mais doit etre approuve par l'administrateur.", "warning");
  }
  if (params.get("rejected") === "1") {
    authMessage("Votre demande d'acces a ete rejetee.", "warning");
  }
  if (params.get("suspended") === "1") {
    const until = params.get("until") ? new Date(params.get("until")).toLocaleString() : "bientôt";
    authMessage(`Votre compte est temporairement suspendu jusqu'au ${until}.`, "warning");
  }

  const setMode = (nextMode) => {
    mode = nextMode;
    signin.hidden = mode !== "signin";
    signup.hidden = mode !== "signup";
    signinTab.setAttribute("aria-pressed", String(mode === "signin"));
    signupTab.setAttribute("aria-pressed", String(mode === "signup"));
    title.textContent = mode === "signin" ? "Connexion" : "Inscription";
    subtitle.textContent = mode === "signin"
      ? "Connectez-vous avec votre compte approuve."
      : "Demandez un acces, puis attendez la validation administrateur.";
    document.getElementById("authMessage").hidden = true;
  };

  signinTab.addEventListener("click", () => setMode("signin"));
  signupTab.addEventListener("click", () => setMode("signup"));
  if (guestButton) {
    guestButton.addEventListener("click", () => {
      localStorage.setItem("portalGuest", "tunis");
      window.location.href = safeNext(params.get("next"), TUNIS_AUTH.appPath);
    });
  }

  signin.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submitButton = signin.querySelector('button[type="submit"]');
    if (submitButton) submitButton.disabled = true;
    authMessage("Connexion en cours...", "info");
    try {
      const email = document.getElementById("signinEmail").value.trim();
      const password = document.getElementById("signinPassword").value;
      const { data, error } = await tunisSupabase.auth.signInWithPassword({ email, password });
      if (error) return authMessage("Email ou mot de passe incorrect.");

      const { data: profile } = await tunisSupabase.from(TUNIS_AUTH.table).select("*").eq("id", data.user.id).single();
      if (!profile || profile.rejected || !profile.approved) {
        await tunisSupabase.auth.signOut();
        return authMessage(profile && profile.rejected ? "Demande d'acces rejetee." : "Compte en attente d'approbation.", "warning");
      }

      if (profile.suspended_until && new Date(profile.suspended_until) > new Date()) {
        await tunisSupabase.auth.signOut();
        return authMessage(`Votre compte est temporairement suspendu jusqu'au ${new Date(profile.suspended_until).toLocaleString()}.`, "warning");
      }

      localStorage.removeItem("portalGuest");
      logUserSession("tunisia", tunisSupabase);
      window.location.href = safeNext(params.get("next"), TUNIS_AUTH.appPath);
    } finally {
      if (submitButton) submitButton.disabled = false;
    }
  });

  const forgotBtn = document.getElementById("forgotBtn");
  if (forgotBtn) {
    forgotBtn.addEventListener("click", async () => {
      authMessage("Pour reinitialiser votre mot de passe, contactez l'administrateur sur WhatsApp: 27265400", "info");
    });
  }

  signup.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submitButton = signup.querySelector('button[type="submit"]');
    if (submitButton) submitButton.disabled = true;
    authMessage("Creation du compte...", "info");
    try {
      const username = document.getElementById("signupName").value.trim();
      const email = document.getElementById("signupEmail").value.trim();
      const password = document.getElementById("signupPassword").value;
      const avatar_url = avatarFor(username);
      const { data, error } = await tunisSupabase.auth.signUp({
        email,
        password,
        options: { data: { username, avatar_url, portal: "tunisia" } }
      });
      if (error) return authMessage(friendlyAuthError(error));
      if (!data.user) return authMessage("Compte non cree. Verifiez la configuration Supabase.");
      if (data.session) {
        const { error: profileError } = await tunisSupabase.from(TUNIS_AUTH.table).upsert({
          id: data.user.id,
          email,
          username,
          avatar_url,
          progress: {}
        }, { onConflict: "id", ignoreDuplicates: true });
        if (profileError) {
          return authMessage(`Compte Auth cree, mais profil bloque: ${profileError.message}. Executez les fichiers SQL mis a jour.`, "warning");
        }
      }
      signup.reset();
      authMessage("Compte cree. Il sera accessible apres approbation administrateur.", "success");
    } finally {
      if (submitButton) submitButton.disabled = false;
    }
  });
}

if (document.documentElement.dataset.authPage === "tunis") {
  setupTunisLogin();
} else {
  window.portalAuthReady = ensureTunisApprovedSession();
}
