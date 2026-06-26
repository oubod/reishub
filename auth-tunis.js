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

const isExistingAccountError = (error) =>
  /already registered|already exists|user already|email.*exists/i.test(error?.message || "");

const isMissingRpcError = (error) =>
  /could not find|not found|schema cache|function .* does not exist/i.test(error?.message || "");

const isSuspendedProfile = (profile) =>
  profile?.suspended_until && new Date(profile.suspended_until) > new Date();

const profileNameFor = (user, fallbackUsername) =>
  fallbackUsername ||
  user?.user_metadata?.username ||
  user?.email?.split("@")[0] ||
  "Utilisateur";

async function fetchTunisProfile(userId) {
  const { data, error } = await tunisSupabase
    .from(TUNIS_AUTH.table)
    .select("*")
    .eq("id", userId)
    .maybeSingle();
  if (error) console.warn("Tunis profile lookup failed:", error.message);
  return data || null;
}

async function insertPendingTunisProfile(user, options = {}) {
  const username = profileNameFor(user, options.username);
  const payload = {
    id: user.id,
    email: user.email,
    username,
    avatar_url: options.avatar_url || user.user_metadata?.avatar_url || avatarFor(username),
    progress: {}
  };
  if (options.bankily) payload.bankily_code = options.bankily;

  const { error } = await tunisSupabase
    .from(TUNIS_AUTH.table)
    .upsert(payload, { onConflict: "id", ignoreDuplicates: true });

  if (!error) return fetchTunisProfile(user.id);
  if (!("bankily_code" in payload)) {
    console.warn("Tunis profile insert failed:", error.message);
    return null;
  }

  delete payload.bankily_code;
  const { error: fallbackError } = await tunisSupabase
    .from(TUNIS_AUTH.table)
    .upsert(payload, { onConflict: "id", ignoreDuplicates: true });
  if (fallbackError) {
    console.warn("Tunis profile fallback insert failed:", fallbackError.message);
    return null;
  }
  return fetchTunisProfile(user.id);
}

async function ensureTunisProfile(user, options = {}) {
  let profile = await fetchTunisProfile(user.id);
  if (profile) return profile;

  try {
    const { error } = await tunisSupabase.rpc("ensure_cross_app_profile", { target_app: "tunisia" });
    if (!error) {
      profile = await fetchTunisProfile(user.id);
      if (profile) return profile;
    } else if (!isMissingRpcError(error)) {
      console.warn("Cross-app profile helper failed:", error.message);
    }
  } catch (error) {
    console.warn("Cross-app profile helper unavailable:", error);
  }

  return insertPendingTunisProfile(user, options);
}

async function finishTunisLogin(profile, params) {
  if (!profile || profile.rejected || !profile.approved) {
    await tunisSupabase.auth.signOut();
    return authMessage(profile && profile.rejected ? "Demande d'acces rejetee." : "Demande d'acces Tunis en attente d'approbation.", "warning");
  }

  if (isSuspendedProfile(profile)) {
    await tunisSupabase.auth.signOut();
    return authMessage(`Votre compte est temporairement suspendu jusqu'au ${new Date(profile.suspended_until).toLocaleString()}.`, "warning");
  }

  localStorage.removeItem("portalGuest");
  logUserSession("tunisia", tunisSupabase);
  window.location.href = safeNext(params.get("next"), TUNIS_AUTH.appPath);
}

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

  const profile = await ensureTunisProfile(session.user);

  if (!profile || profile.rejected || !profile.approved) {
    await tunisSupabase.auth.signOut();
    window.location.replace(`${TUNIS_AUTH.loginPath}?${profile && profile.rejected ? "rejected" : "pending"}=1`);
    return null;
  }

  if (isSuspendedProfile(profile)) {
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
      const phone = document.getElementById("signinEmail").value.trim().replace(/\s+/g, "");
      const email = phone + "@resihub.app";
      const password = document.getElementById("signinPassword").value;
      const { data, error } = await tunisSupabase.auth.signInWithPassword({ email, password });
      if (error) return authMessage("Num\u00e9ro ou mot de passe incorrect.");

      const profile = await ensureTunisProfile(data.user);
      await finishTunisLogin(profile, params);
    } finally {
      if (submitButton) submitButton.disabled = false;
    }
  });

  const forgotBtn = document.getElementById("forgotBtn");
  if (forgotBtn) {
    forgotBtn.addEventListener("click", async () => {
      authMessage("Pour reinitialiser votre mot de passe, contactez l'administrateur sur WhatsApp: 43265506", "info");
    });
  }

  signup.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submitButton = signup.querySelector('button[type="submit"]');
    if (submitButton) submitButton.disabled = true;
    authMessage("Creation du compte...", "info");
    try {
      const username = document.getElementById("signupName").value.trim();
      const phone = document.getElementById("signupEmail").value.trim().replace(/\s+/g, "");
      const email = phone + "@resihub.app";
      const password = document.getElementById("signupPassword").value;
      const bankily = document.getElementById("signupBankily")?.value.trim() || "";
      const avatar_url = avatarFor(username);
      let { data, error } = await tunisSupabase.auth.signUp({
        email,
        password,
        options: { data: { username, avatar_url, portal: "tunisia", bankily_code: bankily, phone } }
      });
      if (error && isExistingAccountError(error)) {
        const login = await tunisSupabase.auth.signInWithPassword({ email, password });
        if (login.error) {
          return authMessage("Ce numero existe deja. Entrez son mot de passe actuel pour demander l'acces Tunis.", "warning");
        }
        const profile = await ensureTunisProfile(login.data.user, { username, bankily, avatar_url });
        if (profile?.approved && !profile.rejected && !isSuspendedProfile(profile)) {
          return finishTunisLogin(profile, params);
        }
        await tunisSupabase.auth.signOut();
        signup.reset();
        return authMessage(profile?.rejected ? "Demande d'acces rejetee." : "Demande d'acces Tunis enregistree. Attendez la validation administrateur.", "success");
      }
      if (error) return authMessage(friendlyAuthError(error));
      if (!data.user) return authMessage("Compte non cree. Verifiez la configuration Supabase.");
      if (data.session) {
        const profile = await ensureTunisProfile(data.user, { username, bankily, avatar_url });
        if (!profile) {
          return authMessage("Compte Auth cree, mais la demande Tunis n'a pas pu etre enregistree.", "warning");
        }
        if (profile.approved && !profile.rejected && !isSuspendedProfile(profile)) {
          return finishTunisLogin(profile, params);
        }
        await tunisSupabase.auth.signOut();
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
