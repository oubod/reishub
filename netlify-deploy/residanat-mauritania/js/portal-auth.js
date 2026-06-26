const MAURITANIA_AUTH = {
    table: 'mauritania_profiles',
    appPath: new URL('mauritania-tunis-lite.html', location.href).href,
    loginPath: new URL('login.html', location.href).href
};

const mauritaniaAppPath = () => new URL('mauritania-tunis-lite.html', location.href).href;
const mauritaniaLoginPath = () => new URL('login.html', location.href).href;

const mauritaniaAuthMessage = (message, type = 'error') => {
    const node = document.getElementById('authMessage');
    if (!node) return;
    node.textContent = message;
    node.dataset.type = type;
    node.hidden = false;
};

const mauritaniaAvatarFor = (username) =>
    `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(username || 'NKTT')}&backgroundColor=007AFF&textColor=FFFFFF&radius=50`;

const mauritaniaFriendlyAuthError = (error) =>
    error && (error.status === 429 || /rate limit|too many/i.test(error.message || ''))
        ? 'Trop de tentatives. Attendez une minute puis reessayez.'
        : (error && error.message) || 'Erreur Supabase.';

const mauritaniaExistingAccountError = (error) =>
    /already registered|already exists|user already|email.*exists/i.test(error?.message || '');

const mauritaniaMissingRpcError = (error) =>
    /could not find|not found|schema cache|function .* does not exist/i.test(error?.message || '');

const mauritaniaIsSuspendedProfile = (profile) =>
    profile?.suspended_until && new Date(profile.suspended_until) > new Date();

const mauritaniaProfileNameFor = (user, fallbackUsername) =>
    fallbackUsername ||
    user?.user_metadata?.username ||
    user?.email?.split('@')[0] ||
    'Utilisateur';

async function fetchMauritaniaProfile(userId) {
    const { data, error } = await supabaseClient
        .from(MAURITANIA_AUTH.table)
        .select('*')
        .eq('id', userId)
        .maybeSingle();
    if (error) console.warn('Mauritania profile lookup failed:', error.message);
    return data || null;
}

async function insertPendingMauritaniaProfile(user, options = {}) {
    const username = mauritaniaProfileNameFor(user, options.username);
    const payload = {
        id: user.id,
        email: user.email,
        username,
        avatar_url: options.avatar_url || user.user_metadata?.avatar_url || mauritaniaAvatarFor(username),
        progress: {}
    };
    if (options.bankily) payload.bankily_code = options.bankily;

    const { error } = await supabaseClient
        .from(MAURITANIA_AUTH.table)
        .upsert(payload, { onConflict: 'id', ignoreDuplicates: true });

    if (!error) return fetchMauritaniaProfile(user.id);
    if (!('bankily_code' in payload)) {
        console.warn('Mauritania profile insert failed:', error.message);
        return null;
    }

    delete payload.bankily_code;
    const { error: fallbackError } = await supabaseClient
        .from(MAURITANIA_AUTH.table)
        .upsert(payload, { onConflict: 'id', ignoreDuplicates: true });
    if (fallbackError) {
        console.warn('Mauritania profile fallback insert failed:', fallbackError.message);
        return null;
    }
    return fetchMauritaniaProfile(user.id);
}

async function ensureMauritaniaProfile(user, options = {}) {
    let profile = await fetchMauritaniaProfile(user.id);
    if (profile) return profile;

    try {
        const { error } = await supabaseClient.rpc('ensure_cross_app_profile', { target_app: 'mauritania' });
        if (!error) {
            profile = await fetchMauritaniaProfile(user.id);
            if (profile) return profile;
        } else if (!mauritaniaMissingRpcError(error)) {
            console.warn('Cross-app profile helper failed:', error.message);
        }
    } catch (error) {
        console.warn('Cross-app profile helper unavailable:', error);
    }

    return insertPendingMauritaniaProfile(user, options);
}

async function finishMauritaniaLogin(profile) {
    if (!profile || profile.rejected || !profile.approved) {
        await supabaseClient.auth.signOut();
        return mauritaniaAuthMessage(profile && profile.rejected ? "Demande d'acces rejetee." : "Demande d'acces Mauritanie en attente d'approbation.", 'warning');
    }

    if (mauritaniaIsSuspendedProfile(profile)) {
        await supabaseClient.auth.signOut();
        return mauritaniaAuthMessage(`Votre compte est temporairement suspendu jusqu'au ${new Date(profile.suspended_until).toLocaleString()}.`, 'warning');
    }

    localStorage.removeItem('portalGuest');
    logUserSession('mauritania', supabaseClient);
    window.location.href = mauritaniaAppPath();
}

async function logUserSession(appKey, supabaseClientInstance) {
    try {
        const res = await fetch('https://ipapi.co/json/');
        if (!res.ok) throw new Error('IP fetch failed');
        const geo = await res.json();
        await supabaseClientInstance.rpc('log_user_login', {
            app_key: appKey,
            ip_address: geo.ip || 'Unknown',
            latitude: geo.latitude ? parseFloat(geo.latitude) : null,
            longitude: geo.longitude ? parseFloat(geo.longitude) : null,
            user_agent: navigator.userAgent
        });
    } catch (err) {
        console.error('Failed to log session:', err);
        try {
            await supabaseClientInstance.rpc('log_user_login', {
                app_key: appKey,
                ip_address: 'Unknown',
                latitude: null,
                longitude: null,
                user_agent: navigator.userAgent
            });
        } catch (e) {
            console.error('Fallback log failed:', e);
        }
    }
}

async function ensureMauritaniaApprovedSession() {
    if (localStorage.getItem('portalGuest') === 'mauritania') {
        window.portalAuthUser = { id: 'guest-mauritania', email: 'guest@local' };
        window.portalAuthProfile = {
            id: 'guest-mauritania',
            username: 'Invite',
            avatar_url: mauritaniaAvatarFor('Invite'),
            progress: {},
            approved: true,
            isGuest: true
        };
        return { session: null, profile: window.portalAuthProfile, guest: true };
    }

    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session) {
        window.location.replace(`${mauritaniaLoginPath()}?next=${encodeURIComponent(mauritaniaAppPath())}`);
        return null;
    }

    const profile = await ensureMauritaniaProfile(session.user);

    if (!profile || profile.rejected || !profile.approved) {
        await supabaseClient.auth.signOut();
        window.location.replace(`${mauritaniaLoginPath()}?${profile && profile.rejected ? 'rejected' : 'pending'}=1`);
        return null;
    }

    if (mauritaniaIsSuspendedProfile(profile)) {
        await supabaseClient.auth.signOut();
        window.location.replace(`${mauritaniaLoginPath()}?suspended=1&until=${encodeURIComponent(profile.suspended_until)}`);
        return null;
    }

    window.portalAuthUser = session.user;
    window.portalAuthProfile = profile;
    logUserSession('mauritania', supabaseClient);
    return { session, profile };
}

function setupMauritaniaLogin() {
    const signin = document.getElementById('signinForm');
    const signup = document.getElementById('signupForm');
    const signinTab = document.getElementById('signinTab');
    const signupTab = document.getElementById('signupTab');
    const title = document.getElementById('authTitle');
    const subtitle = document.getElementById('authSubtitle');
    const guestButton = document.getElementById('guestButton');
    const params = new URLSearchParams(location.search);
    let mode = 'signin';

    if (!signin || !signup || !signinTab || !signupTab || !title || !subtitle) {
        console.warn('Mauritania auth screen is missing required elements.');
        return;
    }

    if (params.get('pending') === '1') {
        mauritaniaAuthMessage("Votre compte doit etre approuve par l'administrateur.", 'warning');
    }
    if (params.get('rejected') === '1') {
        mauritaniaAuthMessage("Votre demande d'acces a ete rejetee.", 'warning');
    }
    if (params.get('suspended') === '1') {
        const until = params.get('until') ? new Date(params.get('until')).toLocaleString() : 'bientôt';
        mauritaniaAuthMessage(`Votre compte est temporairement suspendu jusqu'au ${until}.`, 'warning');
    }

    const setMode = (nextMode) => {
        mode = nextMode;
        signin.hidden = mode !== 'signin';
        signup.hidden = mode !== 'signup';
        signinTab.setAttribute('aria-pressed', String(mode === 'signin'));
        signupTab.setAttribute('aria-pressed', String(mode === 'signup'));
        title.textContent = mode === 'signin' ? 'Connexion' : 'Inscription';
        subtitle.textContent = mode === 'signin'
            ? 'Connectez-vous avec votre compte approuve.'
            : 'Demandez un acces, puis attendez la validation administrateur.';
        document.getElementById('authMessage').hidden = true;
    };

    signinTab.addEventListener('click', () => setMode('signin'));
    signupTab.addEventListener('click', () => setMode('signup'));
    if (guestButton) {
        guestButton.addEventListener('click', () => {
            localStorage.setItem('portalGuest', 'mauritania');
            window.location.href = mauritaniaAppPath();
        });
    }

    signin.addEventListener('submit', async (event) => {
        event.preventDefault();
        const submitButton = signin.querySelector('button[type="submit"]');
        if (submitButton) submitButton.disabled = true;
        mauritaniaAuthMessage('Connexion en cours...', 'info');
        try {
            const phone = document.getElementById('signinEmail').value.trim().replace(/\s+/g, '');
            const email = phone + '@resihub.app';
            const password = document.getElementById('signinPassword').value;
            const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
            if (error) return mauritaniaAuthMessage('Num\u00e9ro ou mot de passe incorrect.');

            const profile = await ensureMauritaniaProfile(data.user);
            await finishMauritaniaLogin(profile);
        } finally {
            if (submitButton) submitButton.disabled = false;
        }
    });

    const forgotBtn = document.getElementById('forgotBtn');
    if (forgotBtn) {
        forgotBtn.addEventListener('click', async () => {
            mauritaniaAuthMessage('Pour reinitialiser votre mot de passe, contactez l\'administrateur sur WhatsApp: 43265506', 'info');
        });
    }

    signup.addEventListener('submit', async (event) => {
        event.preventDefault();
        const submitButton = signup.querySelector('button[type="submit"]');
        if (submitButton) submitButton.disabled = true;
        mauritaniaAuthMessage('Creation du compte...', 'info');
        try {
            const username = document.getElementById('signupName').value.trim();
            const phone = document.getElementById('signupEmail').value.trim().replace(/\s+/g, '');
            const email = phone + '@resihub.app';
            const password = document.getElementById('signupPassword').value;
            const bankily = document.getElementById('signupBankily')?.value.trim() || '';
            const avatar_url = mauritaniaAvatarFor(username);
            const { data, error } = await supabaseClient.auth.signUp({
                email,
                password,
                options: { data: { username, avatar_url, portal: 'mauritania', bankily_code: bankily, phone } }
            });
            if (error && mauritaniaExistingAccountError(error)) {
                const login = await supabaseClient.auth.signInWithPassword({ email, password });
                if (login.error) {
                    return mauritaniaAuthMessage("Ce numero existe deja. Entrez son mot de passe actuel pour demander l'acces Mauritanie.", 'warning');
                }
                const profile = await ensureMauritaniaProfile(login.data.user, { username, bankily, avatar_url });
                if (profile?.approved && !profile.rejected && !mauritaniaIsSuspendedProfile(profile)) {
                    return finishMauritaniaLogin(profile);
                }
                await supabaseClient.auth.signOut();
                signup.reset();
                return mauritaniaAuthMessage(profile?.rejected ? "Demande d'acces rejetee." : "Demande d'acces Mauritanie enregistree. Attendez la validation administrateur.", 'success');
            }
            if (error) return mauritaniaAuthMessage(mauritaniaFriendlyAuthError(error));
            if (!data.user) return mauritaniaAuthMessage('Compte non cree. Verifiez la configuration Supabase.');
            if (data.session) {
                const profile = await ensureMauritaniaProfile(data.user, { username, bankily, avatar_url });
                if (!profile) {
                    return mauritaniaAuthMessage("Compte Auth cree, mais la demande Mauritanie n'a pas pu etre enregistree.", 'warning');
                }
                if (profile.approved && !profile.rejected && !mauritaniaIsSuspendedProfile(profile)) {
                    return finishMauritaniaLogin(profile);
                }
                await supabaseClient.auth.signOut();
            }
            signup.reset();
            mauritaniaAuthMessage('Compte cree. Il sera accessible apres approbation administrateur.', 'success');
        } finally {
            if (submitButton) submitButton.disabled = false;
        }
    });
}

if (document.documentElement.dataset.authPage === 'mauritania') {
    setupMauritaniaLogin();
} else {
    window.portalAuthReady = ensureMauritaniaApprovedSession();
}
