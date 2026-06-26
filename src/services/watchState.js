import { reactive } from 'vue';
const watchState = reactive({
    isLoggedIn: false,
    isAuthRestoring:
        typeof window !== 'undefined' && Boolean(window.__VRCX_REMOTE__),
    isFriendsLoaded: false,
    isFavoritesLoaded: false
});

export { watchState };
