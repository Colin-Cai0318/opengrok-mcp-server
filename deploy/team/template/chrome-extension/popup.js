const status = document.getElementById("status");
const openButton = document.getElementById("open");
const syncButton = document.getElementById("sync");
let targets = [];

function send(message) {
  return new Promise((resolve) => chrome.runtime.sendMessage(message, (response) => {
    if (chrome.runtime.lastError) resolve({ ok: false, error: chrome.runtime.lastError.message });
    else resolve(response || { ok: false, error: "No response" });
  }));
}

async function grantSiteAccess() {
  const origins = [...new Set(targets.map((target) => {
    const url = new URL(target.url);
    return `${url.protocol}//${url.hostname}/*`;
  }))];
  if (!origins.length) throw new Error("没有已启用的服务器");
  if (!await chrome.permissions.request({ origins })) {
    throw new Error("需要允许扩展访问已启用的 OpenGrok 站点，才能同步 Cookie");
  }
}

send({ type: "targets" }).then((response) => {
  if (!response.ok) throw new Error(response.error || "无法读取服务器列表");
  targets = response.targets || [];
  openButton.disabled = syncButton.disabled = targets.length === 0;
  status.textContent = `当前启用 ${targets.length} 个服务器。Cookie 变化时自动同步，并每 5 分钟检查一次。`;
}).catch((error) => { status.textContent = `服务器列表读取失败：${error.message}`; });

document.getElementById("health").addEventListener("click", async () => {
  status.textContent = "检查中...";
  const response = await send({ type: "health" });
  if (!response.ok) { status.textContent = `Helper 异常：${response.error}`; return; }
  const data = response.data || {};
  const lines = ["Helper 正常", `最后同步: ${data.updatedAt || "尚未同步"}`];
  for (const [key, value] of Object.entries(data.cookies || {})) {
    lines.push(`${key}: ${value.present ? "已获取" : "缺失"}`);
  }
  status.textContent = lines.join("\n");
});

openButton.addEventListener("click", async () => {
  try {
    await grantSiteAccess();
    const response = await send({ type: "openLogins" });
    status.textContent = response.ok ? `已打开 ${response.count} 个登录页` : `打开失败：${response.error || "unknown"}`;
  } catch (error) { status.textContent = `打开失败：${error.message}`; }
});

syncButton.addEventListener("click", async () => {
  try {
    await grantSiteAccess();
    status.textContent = "正在同步...";
    const response = await send({ type: "syncNow" });
    if (!response.ok) { status.textContent = `同步失败：${response.error || response.reason || "unknown"}`; return; }
    const lines = [response.changed ? "同步成功：Cookie 已更新" : "同步成功：Cookie 无变化"];
    for (const target of Object.values(response.targets || {})) {
      lines.push(target.ok ? `${target.label}: ${target.count} cookies` : `${target.label}: 未获取 (${target.error || "not logged in"})`);
    }
    status.textContent = lines.join("\n");
  } catch (error) { status.textContent = `同步失败：${error.message}`; }
});
