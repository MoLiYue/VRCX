using NLog;
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Net.Sockets;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;

namespace VRCX
{
    public class RemoteAccessServer
    {
        private const string EnabledKey = "VRCX_RemoteAccessEnabled";
        private const string PortKey = "VRCX_RemoteAccessPort";
        private const string TokenKey = "VRCX_RemoteAccessToken";
        private const int DefaultPort = 23590;

        private static readonly Logger Logger = LogManager.GetCurrentClassLogger();
        private static readonly HttpClient HttpClient = new();
        private static readonly JsonSerializerOptions JsonOptions = new() { PropertyNameCaseInsensitive = true };
        public static RemoteAccessServer Instance { get; private set; }

        private readonly object _lock = new();
        private readonly Dictionary<string, object> _rpcTargets = new(StringComparer.Ordinal);
        private CancellationTokenSource _cancellationTokenSource;
        private TcpListener _listener;

        static RemoteAccessServer()
        {
            Instance = new RemoteAccessServer();
        }

        public RemoteAccessServer()
        {
            Instance = this;
        }

        public void Init()
        {
            EnsureToken();
            if (IsEnabled)
                Start();
        }

        public void Exit()
        {
            Stop();
        }

        public void RegisterTarget(string className, object target)
        {
            if (string.IsNullOrWhiteSpace(className) || target == null)
                return;

            lock (_lock)
                _rpcTargets[className] = target;
        }

        public bool IsEnabled => VRCXStorage.Instance.Get(EnabledKey) == "true";

        public int Port
        {
            get
            {
                if (int.TryParse(VRCXStorage.Instance.Get(PortKey), out var port) && IsValidPort(port))
                    return port;
                return DefaultPort;
            }
        }

        public string Token => EnsureToken();

        public string GetConfigJson()
        {
            return JsonSerializer.Serialize(new
            {
                enabled = IsEnabled,
                running = _listener != null,
                port = Port,
                token = Token,
                urls = GetUrls(Port)
            });
        }

        public string SetConfig(bool enabled, int port)
        {
            if (!IsValidPort(port))
                port = DefaultPort;

            VRCXStorage.Instance.Set(EnabledKey, enabled ? "true" : "false");
            VRCXStorage.Instance.Set(PortKey, port.ToString());
            VRCXStorage.Instance.Save();

            if (enabled)
                Restart();
            else
                Stop();

            return GetConfigJson();
        }

        public string RegenerateToken()
        {
            VRCXStorage.Instance.Set(TokenKey, GenerateToken());
            VRCXStorage.Instance.Save();
            return GetConfigJson();
        }

        private void Restart()
        {
            Stop();
            Start();
        }

        private void Start()
        {
            lock (_lock)
            {
                if (_listener != null)
                    return;

                try
                {
                    _cancellationTokenSource = new CancellationTokenSource();
                    _listener = new TcpListener(IPAddress.Any, Port);
                    _listener.Start();
                    _ = Task.Run(() => AcceptLoop(_cancellationTokenSource.Token));
                    Logger.Info("Remote access server started on port {Port}", Port);
                }
                catch (Exception ex)
                {
                    Logger.Error(ex, "Failed to start remote access server");
                    Stop();
                }
            }
        }

        private void Stop()
        {
            lock (_lock)
            {
                try
                {
                    _cancellationTokenSource?.Cancel();
                    _listener?.Stop();
                }
                catch (Exception ex)
                {
                    Logger.Error(ex, "Failed to stop remote access server");
                }
                finally
                {
                    _listener = null;
                    _cancellationTokenSource?.Dispose();
                    _cancellationTokenSource = null;
                }
            }
        }

        private async Task AcceptLoop(CancellationToken cancellationToken)
        {
            while (!cancellationToken.IsCancellationRequested)
            {
                try
                {
                    var client = await _listener.AcceptTcpClientAsync(cancellationToken);
                    _ = Task.Run(() => ProcessClient(client, cancellationToken), cancellationToken);
                }
                catch (OperationCanceledException)
                {
                    return;
                }
                catch (ObjectDisposedException)
                {
                    return;
                }
                catch (Exception ex)
                {
                    Logger.Error(ex, "Remote access accept loop error");
                }
            }
        }

        private async Task ProcessClient(TcpClient client, CancellationToken cancellationToken)
        {
            using var clientToDispose = client;
            try
            {
                client.ReceiveTimeout = 5000;
                client.SendTimeout = 5000;
                await using var networkStream = client.GetStream();
                var stream = networkStream;

                using var reader = new StreamReader(stream, Encoding.UTF8, false, 8192, true);

                var requestLine = await reader.ReadLineAsync(cancellationToken);
                if (string.IsNullOrWhiteSpace(requestLine))
                    return;

                var parts = requestLine.Split(' ');
                var method = parts[0].ToUpperInvariant();
                if (parts.Length < 2 || (method != "GET" && method != "POST"))
                {
                    await WriteText(stream, 405, "Method Not Allowed", "Method Not Allowed", "text/plain");
                    return;
                }

                var headers = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
                string line;
                while (!string.IsNullOrEmpty(line = await reader.ReadLineAsync(cancellationToken)))
                {
                    var separator = line.IndexOf(':');
                    if (separator > 0)
                        headers[line[..separator].Trim()] = line[(separator + 1)..].Trim();
                }

                var body = string.Empty;
                if (method == "POST" &&
                    headers.TryGetValue("Content-Length", out var contentLengthHeader) &&
                    int.TryParse(contentLengthHeader, out var contentLength) &&
                    contentLength > 0)
                {
                    var buffer = new char[contentLength];
                    var read = await reader.ReadBlockAsync(buffer, 0, contentLength);
                    body = new string(buffer, 0, read);
                }

                await Route(stream, method, new Uri($"http://localhost{parts[1]}"), headers, body);
            }
            catch (Exception ex)
            {
                Logger.Error(ex, "Remote access request failed");
            }
        }

        private async Task Route(Stream stream, string method, Uri uri, Dictionary<string, string> headers, string body)
        {
            if (uri.AbsolutePath == "/api/config")
            {
                await WriteJson(stream, 200, JsonSerializer.Serialize(new
                {
                    enabled = IsEnabled,
                    running = _listener != null,
                    port = Port
                }));
                return;
            }

            if (uri.AbsolutePath == "/remote-login")
            {
                await WriteText(stream, 200, "OK", LoginHtml, "text/html; charset=utf-8");
                return;
            }

            if (!IsAuthorized(uri, headers))
            {
                if (uri.AbsolutePath.StartsWith("/api/", StringComparison.Ordinal))
                    await WriteJson(stream, 401, JsonSerializer.Serialize(new { error = "Unauthorized" }));
                else
                    await WriteText(stream, 200, "OK", LoginHtml, "text/html; charset=utf-8");
                return;
            }

            if (uri.AbsolutePath == "/api/rpc")
            {
                if (method != "POST")
                {
                    await WriteText(stream, 405, "Method Not Allowed", "Method Not Allowed", "text/plain");
                    return;
                }

                await WriteJson(stream, 200, await ExecuteRpc(body));
                return;
            }

            if (method == "GET")
            {
                var response = await GetFrontendResource(uri);
                await WriteBytes(stream, response.StatusCode, StatusText(response.StatusCode), response.Body, response.ContentType);
                return;
            }

            await WriteText(stream, 405, "Method Not Allowed", "Method Not Allowed", "text/plain");
        }

        private async Task<string> ExecuteRpc(string body)
        {
            try
            {
                var request = JsonSerializer.Deserialize<RpcRequest>(body, JsonOptions);
                if (request == null || string.IsNullOrWhiteSpace(request.ClassName) || string.IsNullOrWhiteSpace(request.MethodName))
                    return JsonSerializer.Serialize(new { error = "Invalid RPC request" });

                var target = ResolveRpcTarget(request.ClassName);
                var result = await InvokeRpcTarget(target, request.MethodName, request.Args ?? Array.Empty<JsonElement>());
                return JsonSerializer.Serialize(new { result });
            }
            catch (Exception ex)
            {
                Logger.Error(ex, "Remote access RPC failed");
                return JsonSerializer.Serialize(new { error = ex.GetBaseException().Message });
            }
        }

        private object ResolveRpcTarget(string className)
        {
            lock (_lock)
            {
                if (_rpcTargets.TryGetValue(className, out var registeredTarget))
                    return registeredTarget;
            }

            object target = className switch
            {
                "AppApi" or "AppApiElectron" => Program.AppApiInstance,
                "VRCXStorage" => VRCXStorage.Instance,
                "SQLite" => SQLite.Instance,
                "WebApi" => WebApi.Instance,
                "LogWatcher" => LogWatcher.Instance,
                "Discord" => Discord.Instance,
                "AssetBundleManager" => AssetBundleManager.Instance,
                "RemoteAccessServer" => Instance,
                _ => throw new Exception($"Unsupported RPC class: {className}")
            };

            return target ?? throw new Exception($"RPC target is not initialized: {className}");
        }

        private static async Task<object> InvokeRpcTarget(object target, string methodName, JsonElement[] args)
        {
            var method = target.GetType()
                .GetMethods(BindingFlags.Instance | BindingFlags.Public)
                .Where(item => item.Name == methodName)
                .OrderBy(item => item.GetParameters().Length)
                .FirstOrDefault(item =>
                {
                    var parameters = item.GetParameters();
                    var required = parameters.Count(parameter => !parameter.HasDefaultValue);
                    return args.Length >= required && args.Length <= parameters.Length;
                });

            if (method == null)
                throw new Exception($"Unsupported RPC method: {target.GetType().Name}.{methodName}");

            var parameters = method.GetParameters();
            var convertedArgs = new object[parameters.Length];
            for (var i = 0; i < parameters.Length; i++)
            {
                convertedArgs[i] = i < args.Length
                    ? ConvertJsonArg(args[i], parameters[i].ParameterType)
                    : parameters[i].DefaultValue;
            }

            var result = method.Invoke(target, convertedArgs);
            if (result is Task task)
            {
                await task;
                var resultProperty = task.GetType().GetProperty("Result");
                return resultProperty?.GetValue(task);
            }
            return result;
        }

        private static object ConvertJsonArg(JsonElement arg, Type targetType)
        {
            var nullableType = Nullable.GetUnderlyingType(targetType);
            if (nullableType != null)
                targetType = nullableType;

            if (arg.ValueKind == JsonValueKind.Null)
                return null;
            if (targetType == typeof(string))
                return arg.GetString();
            if (targetType == typeof(bool))
                return arg.GetBoolean();
            if (targetType == typeof(int))
                return arg.GetInt32();
            if (targetType == typeof(long))
                return arg.GetInt64();
            if (targetType == typeof(double))
                return arg.GetDouble();
            if (targetType == typeof(byte[]))
                return Convert.FromBase64String(arg.GetString() ?? string.Empty);
            if (targetType.IsEnum)
                return Enum.Parse(targetType, arg.GetString() ?? string.Empty, true);
            if (typeof(IDictionary<string, object>).IsAssignableFrom(targetType))
                return JsonElementToDictionary(arg);
            if (typeof(IEnumerable<object>).IsAssignableFrom(targetType) && targetType != typeof(string))
                return JsonElementToList(arg);

            return JsonSerializer.Deserialize(arg.GetRawText(), targetType, JsonOptions);
        }

        private static Dictionary<string, object> JsonElementToDictionary(JsonElement element)
        {
            var output = new Dictionary<string, object>();
            if (element.ValueKind != JsonValueKind.Object)
                return output;
            foreach (var property in element.EnumerateObject())
                output[property.Name] = JsonElementToObject(property.Value);
            return output;
        }

        private static List<object> JsonElementToList(JsonElement element)
        {
            var output = new List<object>();
            if (element.ValueKind != JsonValueKind.Array)
                return output;
            output.AddRange(element.EnumerateArray().Select(JsonElementToObject));
            return output;
        }

        private static object JsonElementToObject(JsonElement element)
        {
            return element.ValueKind switch
            {
                JsonValueKind.Object => JsonElementToDictionary(element),
                JsonValueKind.Array => JsonElementToList(element),
                JsonValueKind.String => element.GetString(),
                JsonValueKind.Number => element.TryGetInt64(out var longValue) ? longValue : element.GetDouble(),
                JsonValueKind.True => true,
                JsonValueKind.False => false,
                _ => null
            };
        }

        private static async Task<FrontendResponse> GetFrontendResource(Uri uri)
        {
            var proxied = await TryProxyViteResource(uri);
            if (proxied != null)
                return proxied;

            return TryReadBuiltResource(uri) ??
                   new FrontendResponse(404, Encoding.UTF8.GetBytes("Not Found"), "text/plain");
        }

        private static async Task<FrontendResponse> TryProxyViteResource(Uri uri)
        {
            try
            {
                var viteUri = new Uri($"http://127.0.0.1:9000{uri.PathAndQuery}");
                using var response = await HttpClient.GetAsync(viteUri);
                var bytes = await response.Content.ReadAsByteArrayAsync();
                var contentType = response.Content.Headers.ContentType?.ToString() ?? GetContentType(uri.AbsolutePath);

                if (contentType.Contains("text/html", StringComparison.OrdinalIgnoreCase))
                    bytes = Encoding.UTF8.GetBytes(InjectRemoteFlag(Encoding.UTF8.GetString(bytes)));

                return new FrontendResponse((int)response.StatusCode, bytes, contentType);
            }
            catch
            {
                return null;
            }
        }

        private static FrontendResponse TryReadBuiltResource(Uri uri)
        {
            var relativePath = uri.AbsolutePath == "/" ? "index.html" : Uri.UnescapeDataString(uri.AbsolutePath.TrimStart('/'));
            if (relativePath.Contains("..", StringComparison.Ordinal))
                return null;

            var filePath = Path.Join(Program.BaseDirectory, "html", relativePath);
            if (!File.Exists(filePath))
                filePath = Path.Join(Program.BaseDirectory, relativePath);
            if (!File.Exists(filePath))
                return null;

            var bytes = File.ReadAllBytes(filePath);
            var contentType = GetContentType(filePath);
            if (contentType.Contains("text/html", StringComparison.OrdinalIgnoreCase))
                bytes = Encoding.UTF8.GetBytes(InjectRemoteFlag(Encoding.UTF8.GetString(bytes)));

            return new FrontendResponse(200, bytes, contentType);
        }

        private static string InjectRemoteFlag(string html)
        {
            const string marker = "<script>window.__VRCX_REMOTE__=true;</script>";
            if (html.Contains(marker, StringComparison.Ordinal))
                return html;
            return html.Replace("</head>", $"{marker}</head>", StringComparison.OrdinalIgnoreCase);
        }

        private bool IsAuthorized(Uri uri, Dictionary<string, string> headers)
        {
            var queryToken = GetQueryValue(uri, "token");
            if (FixedTimeEquals(queryToken, Token))
                return true;

            if (headers.TryGetValue("Authorization", out var auth) &&
                auth.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase) &&
                FixedTimeEquals(auth[7..].Trim(), Token))
                return true;

            if (!headers.TryGetValue("Cookie", out var cookie))
                return false;

            foreach (var item in cookie.Split(';'))
            {
                var pair = item.Trim();
                if (pair.StartsWith("vrcx_remote_token=", StringComparison.Ordinal) &&
                    FixedTimeEquals(Uri.UnescapeDataString(pair["vrcx_remote_token=".Length..]), Token))
                    return true;
            }
            return false;
        }

        private static bool FixedTimeEquals(string a, string b)
        {
            if (string.IsNullOrEmpty(a) || string.IsNullOrEmpty(b))
                return false;
            var aBytes = Encoding.UTF8.GetBytes(a);
            var bBytes = Encoding.UTF8.GetBytes(b);
            return aBytes.Length == bBytes.Length && CryptographicOperations.FixedTimeEquals(aBytes, bBytes);
        }

        private static string GetQueryValue(Uri uri, string key)
        {
            var query = uri.Query.TrimStart('?').Split('&', StringSplitOptions.RemoveEmptyEntries);
            foreach (var part in query)
            {
                var separator = part.IndexOf('=');
                var name = separator >= 0 ? part[..separator] : part;
                if (string.Equals(Uri.UnescapeDataString(name), key, StringComparison.Ordinal))
                    return separator >= 0 ? Uri.UnescapeDataString(part[(separator + 1)..]) : string.Empty;
            }
            return string.Empty;
        }

        private static async Task WriteJson(Stream stream, int statusCode, string json)
        {
            await WriteText(stream, statusCode, StatusText(statusCode), json, "application/json; charset=utf-8");
        }

        private static async Task WriteText(Stream stream, int statusCode, string statusText, string body, string contentType)
        {
            await WriteBytes(stream, statusCode, statusText, Encoding.UTF8.GetBytes(body), contentType);
        }

        private static async Task WriteBytes(Stream stream, int statusCode, string statusText, byte[] body, string contentType)
        {
            var header =
                $"HTTP/1.1 {statusCode} {statusText}\r\n" +
                $"Content-Type: {contentType}\r\n" +
                $"Content-Length: {body.Length}\r\n" +
                "Cache-Control: no-store\r\n" +
                "Connection: close\r\n\r\n";
            await stream.WriteAsync(Encoding.ASCII.GetBytes(header));
            await stream.WriteAsync(body);
        }

        private static string StatusText(int statusCode)
        {
            return statusCode switch
            {
                200 => "OK",
                401 => "Unauthorized",
                404 => "Not Found",
                405 => "Method Not Allowed",
                _ => "OK"
            };
        }

        private static bool IsValidPort(int port)
        {
            return port >= 1024 && port <= 65535;
        }

        private static string EnsureToken()
        {
            var token = VRCXStorage.Instance.Get(TokenKey);
            if (!string.IsNullOrEmpty(token))
                return token;

            token = GenerateToken();
            VRCXStorage.Instance.Set(TokenKey, token);
            VRCXStorage.Instance.Save();
            return token;
        }

        private static string GenerateToken()
        {
            return Convert.ToBase64String(RandomNumberGenerator.GetBytes(18))
                .TrimEnd('=')
                .Replace('+', '-')
                .Replace('/', '_');
        }

        private static IEnumerable<string> GetUrls(int port)
        {
            yield return $"http://127.0.0.1:{port}/";
            IPAddress[] addresses;
            try
            {
                addresses = Dns.GetHostAddresses(Dns.GetHostName());
            }
            catch (Exception ex)
            {
                Logger.Debug(ex, "Failed to enumerate remote access URLs");
                yield break;
            }

            foreach (var address in addresses)
            {
                if (address.AddressFamily == AddressFamily.InterNetwork && !IPAddress.IsLoopback(address))
                {
                    yield return $"http://{address}:{port}/";
                }
            }
        }

        private static string GetContentType(string path)
        {
            return Path.GetExtension(path).ToLowerInvariant() switch
            {
                ".html" => "text/html; charset=utf-8",
                ".js" => "text/javascript; charset=utf-8",
                ".mjs" => "text/javascript; charset=utf-8",
                ".css" => "text/css; charset=utf-8",
                ".json" => "application/json; charset=utf-8",
                ".svg" => "image/svg+xml",
                ".png" => "image/png",
                ".jpg" or ".jpeg" => "image/jpeg",
                ".ico" => "image/x-icon",
                ".woff2" => "font/woff2",
                _ => "application/octet-stream"
            };
        }

        private record RpcRequest(string ClassName, string MethodName, JsonElement[] Args);
        private record FrontendResponse(int StatusCode, byte[] Body, string ContentType);

        private const string LoginHtml = """
<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>VRCX Remote</title>
<style>
:root{color-scheme:dark;--bg:#101214;--panel:#181b1f;--text:#f3f5f7;--muted:#9aa3ad;--accent:#58d39f;--bad:#ff6678;--line:#2a3037}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--text);font:15px system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
form{width:min(360px,calc(100vw - 32px));background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:18px}
h1{font-size:20px;margin:0 0 14px}input,button{width:100%;height:40px;border-radius:7px;box-sizing:border-box}input{border:1px solid var(--line);background:#0d0f11;color:var(--text);padding:0 12px}button{margin-top:10px;border:0;background:var(--accent);font-weight:700}.error{color:var(--bad);min-height:20px}
</style>
</head>
<body>
<form id="form">
<h1>VRCX Remote</h1>
<input id="token" autocomplete="current-password" placeholder="Access code">
<button>Open VRCX</button>
<p id="error" class="error"></p>
</form>
<script>
const tokenInput=document.getElementById('token');
const saved=localStorage.getItem('vrcxRemoteToken')||'';
tokenInput.value=saved;
document.getElementById('form').addEventListener('submit',async(event)=>{
event.preventDefault();
const token=tokenInput.value.trim();
localStorage.setItem('vrcxRemoteToken',token);
document.cookie='vrcx_remote_token='+encodeURIComponent(token)+'; path=/; SameSite=Lax';
location.href='/';
});
</script>
</body>
</html>
""";
    }
}
