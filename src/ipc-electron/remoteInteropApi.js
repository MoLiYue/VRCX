class RemoteInteropApi {
    constructor() {
        return new Proxy(this, {
            get(target, prop) {
                if (typeof prop === 'string' && !target[prop]) {
                    return new Proxy(
                        {},
                        {
                            get(_, methodName) {
                                return async (...args) => {
                                    return await target.callMethod(
                                        prop,
                                        methodName,
                                        ...args
                                    );
                                };
                            }
                        }
                    );
                }
                return target[prop];
            }
        });
    }

    async callMethod(className, methodName, ...args) {
        const headers = {
            'Content-Type': 'application/json'
        };
        const token = getRemoteToken();
        if (token) {
            headers.Authorization = `Bearer ${token}`;
        }

        const response = await fetch('/api/rpc', {
            method: 'POST',
            headers,
            body: JSON.stringify({
                className,
                methodName,
                args: args.map(serializeArg)
            })
        });

        const payload = await response.json();
        if (!response.ok || payload.error) {
            throw new Error(payload.error || response.statusText);
        }
        return payload.result;
    }
}

function serializeArg(value) {
    if (value instanceof Map) {
        return Object.fromEntries(
            Array.from(value.entries()).map(([key, item]) => [
                key,
                serializeArg(item)
            ])
        );
    }
    if (Array.isArray(value)) {
        return value.map(serializeArg);
    }
    if (value && typeof value === 'object') {
        return Object.fromEntries(
            Object.entries(value).map(([key, item]) => [key, serializeArg(item)])
        );
    }
    return value;
}

function getRemoteToken() {
    const token = new URLSearchParams(window.location.search).get('token');
    if (token) {
        document.cookie = `vrcx_remote_token=${encodeURIComponent(token)}; path=/; max-age=31536000; SameSite=Lax`;
        return token;
    }
    const match = document.cookie.match(/(?:^|;\s*)vrcx_remote_token=([^;]+)/);
    return match ? decodeURIComponent(match[1]) : '';
}

export default new RemoteInteropApi();
