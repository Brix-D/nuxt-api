import { useCookie } from '#app/composables/cookie';

export function useAccessToken(accessTokenName: string) {
    const path = '/';
    const accessToken = useCookie(accessTokenName, { path });

    return accessToken;
}

export default useAccessToken;