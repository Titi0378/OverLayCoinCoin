(() => {
  const roomInput = document.getElementById("roomInput");
  const cameraNameInput = document.getElementById("cameraNameInput");
  const musicUrlInput = document.getElementById("musicUrlInput");
  const cameraNameField = document.getElementById("cameraNameField");
  const musicUrlField = document.getElementById("musicUrlField");
  const hostRoleBtn = document.getElementById("hostRoleBtn");
  const cameraRoleBtn = document.getElementById("cameraRoleBtn");
  const launchBtn = document.getElementById("launchBtn");

  let selectedRole = null;

  function sanitizeRoomId(value) {
    const normalized = String(value || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9_-]/g, "")
      .slice(0, 64);

    return normalized || "coincoin-party";
  }

  function sanitizeLabel(value) {
    const normalized = String(value || "")
      .trim()
      .replace(/[^a-zA-Z0-9 _-]/g, "")
      .slice(0, 32);

    if (normalized) {
      return normalized;
    }

    return `Camera-${Math.random().toString(36).slice(2, 6)}`;
  }

  function setRole(nextRole) {
    const safeRole = nextRole === "camera" || nextRole === "host" ? nextRole : null;
    selectedRole = safeRole;
    const hasRole = Boolean(selectedRole);

    hostRoleBtn.classList.toggle("is-selected", selectedRole === "host");
    cameraRoleBtn.classList.toggle("is-selected", selectedRole === "camera");

    cameraNameField.hidden = selectedRole !== "camera";
    musicUrlField.hidden = selectedRole !== "host";

    launchBtn.disabled = !hasRole;

    if (!hasRole) {
      launchBtn.textContent = "Choose role first";
      return;
    }

    launchBtn.textContent = selectedRole === "host" ? "Open host dashboard" : "Open camera sender";
  }

  function launch() {
    if (!selectedRole) {
      return;
    }

    const roomId = sanitizeRoomId(roomInput.value);

    if (selectedRole === "host") {
      const hostUrl = new URL("/host.html", window.location.origin);
      hostUrl.searchParams.set("room", roomId);

      const musicUrl = String(musicUrlInput.value || "").trim();
      if (musicUrl) {
        hostUrl.searchParams.set("music", musicUrl);
      }

      window.location.href = hostUrl.toString();
      return;
    }

    const cameraUrl = new URL("/camera.html", window.location.origin);
    cameraUrl.searchParams.set("room", roomId);
    cameraUrl.searchParams.set("label", sanitizeLabel(cameraNameInput.value));
    window.location.href = cameraUrl.toString();
  }

  hostRoleBtn.addEventListener("click", () => setRole("host"));
  cameraRoleBtn.addEventListener("click", () => setRole("camera"));
  launchBtn.addEventListener("click", launch);

  roomInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      launch();
    }
  });

  setRole(null);
})();
