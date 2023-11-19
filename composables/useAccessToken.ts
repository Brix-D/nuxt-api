import { useCookie } from '#imports';

export function useAccessToken(accessTokenName: string) {
    const path = '/';
    const accessToken = useCookie(accessTokenName, { path });

    return accessToken;
}

export default useAccessToken;