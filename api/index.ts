import { $fetch, FetchError, type $Fetch } from 'ofetch';
import { H3Error, sendRedirect } from 'h3';
import { useAccessToken } from '../composables/useAccessToken';
import { createError } from '#imports';

const HTTP_METHODS = ['get', 'post', 'put', 'delete', 'patch'];
const HTTP_NOT_FATAL_ERRORS = [
    401,
    422,
];

type RequestBody = FormData | object | Array<any>;
const HttpMethods = ['get', 'post', 'put', 'delete', 'patch'] as const;
type HttpMethod = typeof HttpMethods[number];
type RefreshTokenParams = { url: string, method: HttpMethod };
interface IRefreshResponse {
    [key: string]: string;
}

const ACCESS_TOKEN_NAME: string = 'access_token';

type IErrors = Record<string, Array<Record<string, any>>>;

interface IErrorResponse {
    errors?: IErrors;
}

export interface ApiMethods {
    get<Response>(
        url: string,
        data?: RequestBody,
        module?: string
    ): Promise<Response & IErrorResponse>;
    post<Response>(
        url: string,
        data?: RequestBody,
        module?: string
    ): Promise<Response & IErrorResponse>;
    put<Response>(
        url: string,
        data?: RequestBody,
        module?: string
    ): Promise<Response & IErrorResponse>;
    patch<Response>(
        url: string,
        data?: RequestBody,
        module?: string
    ): Promise<Response & IErrorResponse>;
    delete<Response>(
        url: string,
        data?: RequestBody,
        module?: string
    ): Promise<Response & IErrorResponse>;
}

interface ApiOptions {
    baseUrl: string;
    prefix?: string;
    module?: string;
    token?: string | null;
    refresh?: RefreshTokenParams;
    accessTokenName?: string;
}

type RequestData = FormData | object | Array<any>;

interface RequestOptions {
    method: string;
    headers: Record<string, any>;
    body?: RequestData;
}

export class Api {
    private provider: $Fetch | null = null;
    private token?: string | null = undefined;
    private module?: string = '';
    private refresh: Promise<string> | null = null;
    private refreshOptions?: RefreshTokenParams;
    private accessTokenName: string;

    constructor(apiOptions: ApiOptions) {
        this.accessTokenName = apiOptions.accessTokenName ?? ACCESS_TOKEN_NAME;
        if (this.provider === null) {
            this.token = apiOptions.token;
            this.module = apiOptions.module;
            this.refreshOptions = apiOptions.refresh;
        
            this.setProvider(this.createProvider(apiOptions));
        }

        return new Proxy(this, {
            get(target, property: string, receiver) {
                if (HTTP_METHODS.includes(property)) {
                    return (url: string, data?: RequestData, module = '') => target.response(url, property, data, module);
                } else {
                    return target[property as keyof Api];
                }
            },
        });
    }

    private setProvider(provider: $Fetch) {
        this.provider = provider;
    }

    private createProvider(apiOptions: ApiOptions): $Fetch {
        const baseURL = apiOptions.prefix ? apiOptions.baseUrl + apiOptions.prefix : apiOptions.baseUrl;
        return $fetch.create({ baseURL});
    }

    private getHeaders() {
        const headers: Record<string, any> = {};
        if (this.token) {
            headers['Authorization'] = 'Bearer ' + this.token;
        }
        return headers;
    }

    private async response<Response = any>(url: string, method: string, data?: RequestData, module = ''): Promise<Response | undefined> {

        const request = async () => {
            const options: RequestOptions = { method, headers: this.getHeaders() };
            if (data) {
                options.body = data;
            }
            if (!this.provider) {
                throw new Error('Провайдер не задан');
            }
            const apiModule = module ? module : this.module;
            const requestUri = apiModule ? `${apiModule}${url}` : url;
            return await this.provider(`/${requestUri}`, options);
        }

        if (!!this.refresh) {
            try {
                const token = await this.refresh;
                this.token = token;
            } catch (error: unknown) {
                throw error;
            }
        }

        const accessToken = useAccessToken(this.accessTokenName);
        // if (method === 'get') {
        //     const { data, error, refresh } = await useAsyncData(async () => {
        //         try {
        //             return await request();
        //         } catch (error: unknown) {
        //             if (error instanceof FetchError) {
        //                 const retry = await this.handleError(error, accessToken, navigateTo);
        //                 if (retry) {
        //                     return await request();
        //                 }
        //             }
        //         }
        //     });
        //     if (error.value) {
        //         throw error;
        //     }
        //     return data.value;
        // } else {
            try {
                return await request();
            } catch (error: unknown) {
                if (error instanceof FetchError || error instanceof H3Error) {
                    const retry = await this.handleError(error, accessToken);
                    if (retry) {
                        return await request();
                    }
                }
            }
       // }
    }

    private async handleError(error: FetchError | H3Error, accessToken: ReturnType<typeof useAccessToken>) {
        let status: number | null | undefined = null;
        if (error instanceof FetchError) {
            status = error.status;
        }
        if (error instanceof H3Error) {
            status = error.statusCode;
        }
        if (status) {
            const isFatal = !HTTP_NOT_FATAL_ERRORS.includes(status);
           
            if (status === 401 && this.refreshOptions !== undefined) {
                if (!this.token) {
                    // await navigateTo(this.unauthorisedRedirectUrl, { replace: true, external: true });
                    throw createError({ fatal: isFatal, statusCode: status });
                }

                if (!this.refresh) {
                    this.refresh = this.handleRefreshToken(accessToken);
                    try {
                        const token = await this.refresh;
                        this.token = token;
                        return true;
                    } catch (error: unknown) {
                        // await navigateTo(this.unauthorisedRedirectUrl, { replace: true, external: true });
                        throw createError({ fatal: isFatal, statusCode: status });
                    }
                } else {
                    try {
                        const token = await this.refresh;
                        this.token = token;
                        return true;
                    } catch (error: unknown) {
                        return false;
                    }
                }
            }

            throw createError({ fatal: isFatal, statusCode: status, data: error.data });
        }
        return false;
    }

    private handleRefreshToken(accessToken: ReturnType<typeof useAccessToken>) {
        return new Promise<string>(async (resolve, reject) => {
            try {
                if (!this.provider) {
                    reject(new Error('Провайдер не задан'));
                    return;
                }
                if (!this.refreshOptions) {
                    reject(new Error('Параметры обновления токена не заданы'));
                    return;
                }
                const options: RequestOptions = { method: this.refreshOptions.method, headers: this.getHeaders() };
                const { [this.accessTokenName]: token } = await this.provider<IRefreshResponse>(this.refreshOptions.url, options);

                this.token = token;
                accessToken.value = token;
                
                resolve(token);
            } catch (error: unknown) {
                reject(error);
            } finally {
                this.refresh = null;
            }
        });
    }
}

export type BApi = ApiMethods & Api;

export default Api;