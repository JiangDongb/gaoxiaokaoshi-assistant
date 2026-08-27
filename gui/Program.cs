// 高校考试网 学习助手 —— WinForms GUI。编译：build.bat
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Text;
using System.Text.RegularExpressions;
using System.Windows.Forms;

namespace GxksGui
{
    // 配置状态：内存中保存 config 参数，可序列化/反序列化 config.json
    public class ConfigState
    {
        public string BaseUrl = "http://www.gaoxiaokaoshi.com";
        public string Browser = "edge";
        public bool Headless = true;
        public int MaxAccounts = 2;
        public int ParallelLessons = 36;
        public int ActionTimeoutSec = 20;
        public int PageTimeoutSec = 60;
        public int CdpBasePort = 9400;
        public string VideoMode = "full";
        public int MaxWatchSec = 7200;
        public int PollSec = 90;
        public int StallToleranceMin = 8;
        public int HomeworkPasses = 2;
        public string FirstPassGuess = "C";
        public string AnswersFile = "answers.json";
        public int MinScore = 60;

        // 从 config.json 文本读取数值/字符串（结构固定，用正则即可）
        public void LoadFromJson(string text)
        {
            Func<string, string> S = (k) =>
            {
                var m = Regex.Match(text, "\"" + Regex.Escape(k) + "\"\\s*:\\s*\"([^\"]*)\"");
                return m.Success ? m.Groups[1].Value : null;
            };
            Func<string, int?> N = (k) =>
            {
                var m = Regex.Match(text, "\"" + Regex.Escape(k) + "\"\\s*:\\s*(-?\\d+)");
                return m.Success ? (int?)int.Parse(m.Groups[1].Value) : null;
            };
            Func<string, bool?> B = (k) =>
            {
                var m = Regex.Match(text, "\"" + Regex.Escape(k) + "\"\\s*:\\s*(true|false)");
                return m.Success ? (bool?)(m.Groups[1].Value == "true") : null;
            };
            string s; int? n; bool? b;
            if ((s = S("base_url")) != null) BaseUrl = s;
            if ((s = S("browser")) != null) Browser = s;
            if ((b = B("headless")) != null) Headless = b.Value;
            if ((n = N("max_accounts")) != null) MaxAccounts = n.Value;
            if ((n = N("parallel_lessons")) != null) ParallelLessons = n.Value;
            if ((n = N("action_timeout_sec")) != null) ActionTimeoutSec = n.Value;
            if ((n = N("page_timeout_sec")) != null) PageTimeoutSec = n.Value;
            if ((n = N("cdp_base_port")) != null) CdpBasePort = n.Value;
            if ((s = S("mode")) != null) VideoMode = s;
            if ((n = N("max_watch_sec")) != null) MaxWatchSec = n.Value;
            if ((n = N("poll_sec")) != null) PollSec = n.Value;
            if ((n = N("stall_tolerance_min")) != null) StallToleranceMin = n.Value;
            if ((n = N("passes")) != null) HomeworkPasses = n.Value;
            if ((s = S("first_pass_guess")) != null) FirstPassGuess = s;
            if ((s = S("answers_file")) != null) AnswersFile = s;
            if ((n = N("min_score")) != null) MinScore = n.Value;
        }

        public string ToJson()
        {
            var sb = new StringBuilder();
            sb.Append("{\n");
            sb.Append("  \"site\": { \"base_url\": \"" + BaseUrl + "\", \"login_page\": \"/Login.aspx\", \"browser\": \"" + Browser + "\", \"headless\": " + Headless.ToString().ToLower() + " },\n");
            sb.Append("  \"concurrency\": { \"max_accounts\": " + MaxAccounts + ", \"parallel_lessons\": " + ParallelLessons + ", \"action_timeout_sec\": " + ActionTimeoutSec + ", \"page_timeout_sec\": " + PageTimeoutSec + ", \"cdp_base_port\": " + CdpBasePort + " },\n");
            sb.Append("  \"video\": { \"mode\": \"" + VideoMode + "\", \"max_watch_sec\": " + MaxWatchSec + ", \"poll_sec\": " + PollSec + ", \"stall_tolerance_min\": " + StallToleranceMin + " },\n");
            sb.Append("  \"homework\": { \"passes\": " + HomeworkPasses + ", \"first_pass_guess\": \"" + FirstPassGuess + "\", \"answers_file\": \"" + AnswersFile + "\", \"min_score\": " + MinScore + " },\n");
            return sb.ToString();
        }
    }

    public static class Program
    {
        [STAThread]
        public static void Main()
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new MainForm());
        }
    }

    public class MainForm : Form
    {
        ConfigState cfg = new ConfigState();
        Process proc = null;
        bool running = false;

        TextBox txtUser, txtPwd, txtPlan, txtCourses;
        CheckBox chkAll;
        Label lblAllHint;
        RichTextBox rtbLog;
        Button btnStart, btnStop, btnSettings;
        Label lblStatus, lblHint;

        public MainForm()
        {
            Text = "高校考试网 学习助手";
            Font = new Font("Microsoft YaHei", 9F);
            ClientSize = new Size(860, 724);
            MinimumSize = new Size(700, 580);
            StartPosition = FormStartPosition.CenterScreen;
            BackColor = Color.FromArgb(245, 247, 250);

            LoadConfigFromFile();
            BuildUi();
            LoadAccountIntoFields();
        }

        string AppDir() { return AppDomain.CurrentDomain.BaseDirectory.TrimEnd('\\'); }
        string ConfigPath() { return Path.Combine(AppDir(), "config.json"); }

        void LoadConfigFromFile()
        {
            try { if (File.Exists(ConfigPath())) cfg.LoadFromJson(File.ReadAllText(ConfigPath(), Encoding.UTF8)); }
            catch { }
        }

        // 把现有 config.json 中的第一个账号读回界面
        void LoadAccountIntoFields()
        {
            try
            {
                var text = File.Exists(ConfigPath()) ? File.ReadAllText(ConfigPath(), Encoding.UTF8) : "";
                var u = Regex.Match(text, "\"username\"\\s*:\\s*\"([^\"]*)\"");
                var p = Regex.Match(text, "\"password\"\\s*:\\s*\"([^\"]*)\"");
                var plan = Regex.Match(text, "\"plan\"\\s*:\\s*\"([^\"]*)\"");
                if (u.Success) txtUser.Text = u.Groups[1].Value;
                if (p.Success) txtPwd.Text = p.Groups[1].Value;
                if (plan.Success) txtPlan.Text = plan.Groups[1].Value;
            }
            catch { }
        }

        // 标题栏
        Label MakeHeader(string text, int x, int y, int w, int h)
        {
            var l = new Label();
            l.Text = text;
            l.Font = new Font("Microsoft YaHei", 11F, FontStyle.Bold);
            l.ForeColor = Color.FromArgb(30, 60, 90);
            l.SetBounds(x, y, w, h);
            Controls.Add(l);
            return l;
        }

        void BuildUi()
        {
            MakeHeader("高校考试网 学习助手", 16, 14, 400, 30);

            // 账号与课程
            var gb = new GroupBox();
            gb.Text = "账号与课程";
            gb.ForeColor = Color.FromArgb(30, 60, 90);
            gb.SetBounds(14, 52, 832, 192);
            gb.Anchor = AnchorStyles.Left | AnchorStyles.Right | AnchorStyles.Top;
            Controls.Add(gb);

            var tl = new TableLayoutPanel();
            tl.SetBounds(10, 24, 812, 130);
            tl.Anchor = AnchorStyles.Left | AnchorStyles.Right | AnchorStyles.Top;
            tl.ColumnCount = 2;
            tl.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 130));
            tl.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
            tl.RowCount = 4;
            for (int i = 0; i < 4; i++) tl.RowStyles.Add(new RowStyle(SizeType.Absolute, 32));
            gb.Controls.Add(tl);

            AddRowLabel(tl, 0, "学习计划：");
            txtPlan = new TextBox(); txtPlan.Text = "军事理论"; tl.Controls.Add(txtPlan, 1, 0);

            AddRowLabel(tl, 1, "账号(用户名)：");
            txtUser = new TextBox(); tl.Controls.Add(txtUser, 1, 1);

            AddRowLabel(tl, 2, "密码：");
            txtPwd = new TextBox(); txtPwd.UseSystemPasswordChar = true; tl.Controls.Add(txtPwd, 1, 2);

            AddRowLabel(tl, 3, "课程选择：");
            var r3 = new TableLayoutPanel();
            r3.ColumnCount = 2;
            r3.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 175));
            r3.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
            r3.Dock = DockStyle.Fill;
            chkAll = new CheckBox();
            chkAll.Text = "学习全部课程";
            chkAll.Checked = true;
            r3.Controls.Add(chkAll, 0, 0);
            txtCourses = new TextBox();
            txtCourses.Visible = false;   // 默认勾选"全部"时隐藏输入框
            r3.Controls.Add(txtCourses, 1, 0);
            lblAllHint = new Label();
            lblAllHint.Text = "（将学习所选计划的全部课时）";
            lblAllHint.ForeColor = Color.Gray;
            lblAllHint.Dock = DockStyle.Fill;
            lblAllHint.TextAlign = ContentAlignment.MiddleLeft;
            r3.Controls.Add(lblAllHint, 1, 0);
            chkAll.CheckedChanged += (s, e) =>
            {
                bool all = chkAll.Checked;
                txtCourses.Enabled = !all;
                txtCourses.Visible = !all;
                lblAllHint.Visible = all;
            };
            tl.Controls.Add(r3, 1, 3);

            var note = new Label();
            note.Text = "不勾选“学习全部课程”时，填写具体课时（用逗号分隔，按名称匹配），留空=全部。";
            note.ForeColor = Color.Gray;
            note.SetBounds(20, 158, 800, 26);
            note.Anchor = AnchorStyles.Left | AnchorStyles.Right | AnchorStyles.Top;
            gb.Controls.Add(note);

            // 按钮
            btnStart = new Button();
            btnStart.Text = "开始学习";
            btnStart.SetBounds(14, 252, 112, 36);
            btnStart.Font = new Font("Microsoft YaHei", 10F);
            btnStart.BackColor = Color.FromArgb(52, 120, 200);
            btnStart.ForeColor = Color.White;
            btnStart.FlatStyle = FlatStyle.Flat;
            btnStart.Click += OnStart;
            btnStart.Anchor = AnchorStyles.Left | AnchorStyles.Top;
            Controls.Add(btnStart);

            btnStop = new Button();
            btnStop.Text = "停止";
            btnStop.SetBounds(134, 252, 90, 36);
            btnStop.Enabled = false;
            btnStop.Click += OnStop;
            btnStop.Anchor = AnchorStyles.Left | AnchorStyles.Top;
            Controls.Add(btnStop);

            btnSettings = new Button();
            btnSettings.Text = "设置";
            btnSettings.SetBounds(232, 252, 90, 36);
            btnSettings.Click += OnSettings;
            btnSettings.Anchor = AnchorStyles.Left | AnchorStyles.Top;
            Controls.Add(btnSettings);

            lblStatus = new Label();
            lblStatus.Text = "就绪";
            lblStatus.SetBounds(336, 260, 500, 22);
            lblStatus.Anchor = AnchorStyles.Left | AnchorStyles.Top;
            Controls.Add(lblStatus);

            // 日志
            rtbLog = new RichTextBox();
            rtbLog.SetBounds(14, 300, 832, 372);
            rtbLog.Anchor = AnchorStyles.Left | AnchorStyles.Right | AnchorStyles.Top | AnchorStyles.Bottom;
            rtbLog.ReadOnly = true;
            rtbLog.Font = new Font("Microsoft YaHei", 9F);
            rtbLog.BackColor = Color.FromArgb(30, 30, 30);
            rtbLog.ForeColor = Color.FromArgb(220, 220, 220);
            Controls.Add(rtbLog);

            // 底部提示
            lblHint = new Label();
            lblHint.Text = "说明：点“开始学习”后自动登录并学习所选课程（默认全部），每课学完自动进入课后练习（第一遍收集答案 → 第二遍按答案作答）。点“设置”可调整并发、视频、作业等参数(保存到 config.json)。";
            lblHint.SetBounds(16, 686, 830, 30);
            lblHint.ForeColor = Color.Gray;
            lblHint.Anchor = AnchorStyles.Left | AnchorStyles.Right | AnchorStyles.Bottom;
            Controls.Add(lblHint);
        }

        void AddRowLabel(TableLayoutPanel tl, int row, string text)
        {
            var l = new Label();
            l.Text = text;
            l.Dock = DockStyle.Fill;
            l.TextAlign = ContentAlignment.MiddleRight;
            l.AutoSize = true;
            tl.Controls.Add(l, 0, row);
        }

        // JSON 字符串转义（防止账号/密码含引号、反斜杠、换行导致配置非法）
        static string JsonStr(string s)
        {
            if (s == null) return "";
            var sb = new StringBuilder(s.Length + 8);
            foreach (char c in s)
            {
                switch (c)
                {
                    case '"': sb.Append("\\\""); break;
                    case '\\': sb.Append("\\\\"); break;
                    case '\b': sb.Append("\\b"); break;
                    case '\f': sb.Append("\\f"); break;
                    case '\n': sb.Append("\\n"); break;
                    case '\r': sb.Append("\\r"); break;
                    case '\t': sb.Append("\\t"); break;
                    default:
                        if (c < 0x20) sb.Append("\\u" + ((int)c).ToString("x4"));
                        else sb.Append(c);
                        break;
                }
            }
            return sb.ToString();
        }

        string BuildConfigJson()
        {
            string head = cfg.ToJson().TrimEnd('\n', ',');
            var lessons = new List<string>();
            if (!chkAll.Checked)
            {
                foreach (var part in txtCourses.Text.Split(new[] { ',', '，', ';', '；' }, StringSplitOptions.RemoveEmptyEntries))
                {
                    var s = part.Trim();
                    if (s.Length > 0) lessons.Add(s);
                }
            }
            var sb = new StringBuilder();
            sb.Append(head);
            sb.Append(",\n");
            sb.Append("  \"accounts\": [\n");
            sb.Append("    {\n");
            sb.Append("      \"name\": \"我的账号\",\n");
            sb.Append("      \"username\": \"" + JsonStr(txtUser.Text.Trim()) + "\",\n");
            sb.Append("      \"password\": \"" + JsonStr(txtPwd.Text) + "\",\n");
            sb.Append("      \"plan\": \"" + JsonStr(txtPlan.Text.Trim()) + "\",\n");
            sb.Append("      \"lessons\": [");
            for (int i = 0; i < lessons.Count; i++)
            {
                if (i > 0) sb.Append(", ");
                sb.Append("\"" + JsonStr(lessons[i]) + "\"");
            }
            sb.Append("],\n");
            sb.Append("      \"watch_videos\": true,\n");
            sb.Append("      \"do_homework\": true\n");
            sb.Append("    }\n");
            sb.Append("  ]\n");
            sb.Append("}\n");
            return sb.ToString();
        }

        // 使用无 BOM 的 UTF8 写文件（Node 的 JSON.parse 不接受 BOM，否则报错）
        static void WriteConfigFile(string path, string content)
        {
            File.WriteAllText(path, content, new System.Text.UTF8Encoding(false));
        }

        void AppendLog(string line)
        {
            if (rtbLog.InvokeRequired) { rtbLog.BeginInvoke(new Action<string>(AppendLog), line); return; }
            rtbLog.AppendText(line + "\n");
            rtbLog.SelectionStart = rtbLog.TextLength;
            rtbLog.ScrollToCaret();
        }

        // 选择要用的 Node：优先用随程序携带的离线 node\node.exe（无需系统安装 Node），否则回退到系统 PATH 的 node
        string ResolveNode()
        {
            string bundled = Path.Combine(AppDir(), "node", "node.exe");
            if (File.Exists(bundled)) return bundled;
            return "node";
        }

        void OnStart(object sender, EventArgs e)
        {
            if (running) { MessageBox.Show("已在运行中，请先点“停止”。", "提示"); return; }
            if (txtUser.Text.Trim().Length == 0 || txtPwd.Text.Length == 0)
            {
                MessageBox.Show("请先填写账号和密码。", "提示");
                return;
            }

            try { WriteConfigFile(ConfigPath(), BuildConfigJson()); }
            catch (Exception ex) { MessageBox.Show("写入配置失败：" + ex.Message, "错误"); return; }

            string node = ResolveNode();
            try
            {
                var psi = new ProcessStartInfo();
                psi.FileName = node;
                psi.Arguments = "main.mjs config.json";
                psi.WorkingDirectory = AppDir();
                psi.UseShellExecute = false;
                psi.CreateNoWindow = true;
                psi.RedirectStandardOutput = true;
                psi.RedirectStandardError = true;
                psi.StandardOutputEncoding = Encoding.UTF8;   // 子进程输出按 UTF8 解码，避免中文乱码
                psi.StandardErrorEncoding = Encoding.UTF8;

                proc = new Process();
                proc.StartInfo = psi;
                proc.OutputDataReceived += (o, a) => { if (a.Data != null) AppendLog(a.Data); };
                proc.ErrorDataReceived += (o, a) => { if (a.Data != null) AppendLog(a.Data); };
                proc.EnableRaisingEvents = true;
                proc.Exited += (o, a) => { running = false; OnProcessExited(); };
                proc.Start();
                proc.BeginOutputReadLine();
                proc.BeginErrorReadLine();

                running = true;
                btnStart.Enabled = false;
                btnStop.Enabled = true;
                lblStatus.Text = "运行中…";
                AppendLog("===== 启动：" + node + " main.mjs config.json =====");
            }
            catch (Exception ex)
            {
                MessageBox.Show("启动失败：" + ex.Message + "\n请确认已安装 Node.js（node 命令可用），且 main.mjs 与本程序在同一目录。", "错误");
            }
        }

        void OnProcessExited()
        {
            if (rtbLog.InvokeRequired) { rtbLog.BeginInvoke(new Action(OnProcessExited)); return; }
            btnStart.Enabled = true;
            btnStop.Enabled = false;
            lblStatus.Text = "已结束 (退出码 " + (proc != null && proc.HasExited ? proc.ExitCode.ToString() : "?") + ")";
            AppendLog("===== 程序结束 =====");
        }

        void OnStop(object sender, EventArgs e)
        {
            if (proc != null && !proc.HasExited)
            {
                try { proc.Kill(); } catch { }
                AppendLog("===== 已手动停止 =====");
            }
        }

        void OnSettings(object sender, EventArgs e)
        {
            try
            {
                using (var f = new SettingsForm(cfg))
                {
                    if (f.ShowDialog() == DialogResult.OK)
                    {
                        try { WriteConfigFile(ConfigPath(), BuildConfigJson()); AppendLog("[设置] 已保存设置到 config.json"); }
                        catch (Exception ex) { MessageBox.Show("保存设置失败：" + ex.Message, "错误"); }
                    }
                }
            }
            catch (Exception ex)
            {
                MessageBox.Show("打开设置失败：" + ex.Message, "错误");
            }
        }

        protected override void OnFormClosing(FormClosingEventArgs e)
        {
            if (proc != null && !proc.HasExited) { try { proc.Kill(); } catch { } }
            base.OnFormClosing(e);
        }
    }

    public class SettingsForm : Form
    {
        ConfigState cfg;
        NumericUpDown numParallel, numMaxAccounts, numMaxWatch, numPoll, numStall, numPasses, numMinScore;
        ComboBox cmbVideoMode;
        TextBox txtGuess, txtAnswersFile;

        public SettingsForm(ConfigState state)
        {
            cfg = state;
            Text = "设置";
            Font = new Font("Microsoft YaHei", 9F);
            ClientSize = new Size(470, 620);
            FormBorderStyle = FormBorderStyle.FixedDialog;
            StartPosition = FormStartPosition.CenterParent;
            MaximizeBox = false; MinimizeBox = false;

            var tl = new TableLayoutPanel();
            tl.Dock = DockStyle.Fill;
            tl.Padding = new Padding(18, 14, 18, 12);
            tl.ColumnCount = 2;
            tl.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 200));
            tl.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
            int rows = 0;
            tl.RowCount = 15;
            for (int i = 0; i < 15; i++) tl.RowStyles.Add(new RowStyle(SizeType.Absolute, 34));
            Controls.Add(tl);

            AddSectionTitle(tl, ref rows, "并发");
            numParallel = AddRow(tl, rows++, "并行课时数", cfg.ParallelLessons, 1, 999, 70);
            numMaxAccounts = AddRow(tl, rows++, "并发账号数", cfg.MaxAccounts, 1, 50, 70);

            AddSectionTitle(tl, ref rows, "视频学习");
            cmbVideoMode = new ComboBox(); cmbVideoMode.Items.AddRange(new object[] { "full", "skip" }); cmbVideoMode.Text = cfg.VideoMode;
            AddRowControl(tl, rows++, "视频模式", cmbVideoMode);
            numMaxWatch = AddRow(tl, rows++, "观看时长上限(秒)", cfg.MaxWatchSec, 60, 86400, 90);
            numPoll = AddRow(tl, rows++, "进度轮询间隔(秒)", cfg.PollSec, 30, 600, 70);
            numStall = AddRow(tl, rows++, "进度停滞容忍(分钟)", cfg.StallToleranceMin, 1, 60, 70);

            AddSectionTitle(tl, ref rows, "课后作业");
            numPasses = AddRow(tl, rows++, "作业遍数", cfg.HomeworkPasses, 1, 5, 70);
            txtGuess = new TextBox(); txtGuess.Text = cfg.FirstPassGuess;
            AddRowControl(tl, rows++, "第一遍猜测项", txtGuess);
            txtAnswersFile = new TextBox(); txtAnswersFile.Text = cfg.AnswersFile;
            AddRowControl(tl, rows++, "答案库文件名", txtAnswersFile);
            numMinScore = AddRow(tl, rows++, "及格分(第二遍)", cfg.MinScore, 0, 100, 70);

            // 说明
            var note = new Label();
            note.Text = "　并行课时数：一次同时学习的课时数；并发账号数：同时运行的账号数。\r\n　视频模式 full=观看完整、skip=跳过观看；时间单位：秒/分钟。\r\n　及格分为第二遍判定线，未达标会提示。";
            note.AutoSize = true;
            note.ForeColor = Color.Gray;
            tl.Controls.Add(note, 0, rows); tl.SetColumnSpan(note, 2); rows++;

            // 底部按钮
            var btnRow = new FlowLayoutPanel();
            btnRow.Dock = DockStyle.Fill;
            btnRow.FlowDirection = FlowDirection.RightToLeft;
            var btnOk = new Button(); btnOk.Text = "保存"; btnOk.DialogResult = DialogResult.OK; btnOk.Width = 90; btnRow.Controls.Add(btnOk);
            var btnCancel = new Button(); btnCancel.Text = "取消"; btnCancel.DialogResult = DialogResult.Cancel; btnCancel.Width = 90; btnRow.Controls.Add(btnCancel);
            tl.Controls.Add(btnRow, 0, rows); tl.SetColumnSpan(btnRow, 2);
        }

        void AddSectionTitle(TableLayoutPanel tl, ref int rows, string title)
        {
            var t = new Label(); t.Text = title; t.Dock = DockStyle.Fill;
            t.Font = new Font("Microsoft YaHei", 10F, FontStyle.Bold);
            t.ForeColor = Color.FromArgb(30, 60, 90);
            t.TextAlign = ContentAlignment.MiddleLeft;
            tl.Controls.Add(t, 0, rows); tl.SetColumnSpan(t, 2); rows++;
        }

        Label MakeRowLabel(string text)
        {
            var l = new Label(); l.Text = text; l.Dock = DockStyle.Fill; l.TextAlign = ContentAlignment.MiddleRight;
            return l;
        }
        NumericUpDown AddRow(TableLayoutPanel tl, int row, string label, int value, int min, int max, int width)
        {
            var n = new NumericUpDown();
            n.Minimum = min;
            n.Maximum = max;   // 先设上下限再赋值，避免越界
            n.Value = Clamp(value, min, max);
            n.Width = width;
            tl.Controls.Add(MakeRowLabel(label), 0, row);
            tl.Controls.Add(n, 1, row);
            return n;
        }
        void AddRowControl(TableLayoutPanel tl, int row, string label, Control c)
        {
            if (c.Width < 60) c.Width = 120;
            tl.Controls.Add(MakeRowLabel(label), 0, row);
            tl.Controls.Add(c, 1, row);
        }
        int Clamp(int v, int lo, int hi) { return v < lo ? lo : (v > hi ? hi : v); }

        protected override void OnFormClosing(FormClosingEventArgs e)
        {
            if (DialogResult == DialogResult.OK)
            {
                try
                {
                    cfg.ParallelLessons = (int)numParallel.Value;
                    cfg.MaxAccounts = (int)numMaxAccounts.Value;
                    cfg.VideoMode = cmbVideoMode.Text;
                    cfg.MaxWatchSec = (int)numMaxWatch.Value;
                    cfg.PollSec = (int)numPoll.Value;
                    cfg.StallToleranceMin = (int)numStall.Value;
                    cfg.HomeworkPasses = (int)numPasses.Value;
                    cfg.FirstPassGuess = txtGuess.Text.Trim();
                    cfg.AnswersFile = txtAnswersFile.Text.Trim();
                    cfg.MinScore = (int)numMinScore.Value;
                }
                catch { }
            }
            base.OnFormClosing(e);
        }
    }
}
