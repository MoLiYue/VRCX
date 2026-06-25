using System.Collections.Generic;

namespace VRCX
{
    public partial class AppApi
    {
        public string GetRemoteAccessConfig()
        {
            return RemoteAccessServer.Instance.GetConfigJson();
        }

        public string SetRemoteAccessConfig(bool enabled, int port)
        {
            return RemoteAccessServer.Instance.SetConfig(enabled, port);
        }

        public string RegenerateRemoteAccessToken()
        {
            return RemoteAccessServer.Instance.RegenerateToken();
        }

        public string GetSavedCredentialsJson()
        {
            var rows = SQLite.Instance.Execute(
                "SELECT `value` FROM `configs` WHERE `key` = @key",
                new Dictionary<string, object>
                {
                    { "@key", "config:savedcredentials" }
                }
            );
            if (rows.Length == 0 || rows[0].Length == 0 || rows[0][0] == null)
                return "{}";
            return rows[0][0].ToString();
        }
    }
}
