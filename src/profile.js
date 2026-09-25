// My profile: display name, display picture (DP), and bio.
// The DP is downscaled client-side and stored in the public chat-files bucket;
// profiles.avatar_url + profiles.bio need supabase-phase5.sql to be applied
// (saving degrades gracefully with a toast until then).
import { supabaseClient } from "./client.js";
import { state } from "./state.js";
import { el, showToast, withBusy, setAvatar } from "./util.js";

let pendingDpFile = null;
let pendingDpPreview = null;

// Refresh the cached own-profile row and the rail avatar + sidebar name.
export async function refreshMyProfile() {
  let { data, error } = await supabaseClient
    .from("profiles")
    .select("username, bio, avatar_url")
    .eq("id", state.currentUser.id)
    .maybeSingle();
  // Graceful fallback until supabase-phase5.sql adds bio/avatar_url.
  if (error && /column/i.test(error.message)) {
    ({ data } = await supabaseClient
      .from("profiles")
      .select("username")
      .eq("id", state.currentUser.id)
      .maybeSingle());
  }
  state.myProfile = { bio: "", avatar_url: null, ...(data || { username: state.currentUsername }) };
  if (data?.username) state.currentUsername = data.username;

  document.getElementById("my-profile-name").textContent = state.currentUsername;
  setAvatar(document.getElementById("rail-avatar"), state.currentUsername, state.myProfile.avatar_url);
}

// Downscale the chosen photo to a small square-ish JPEG (DPs don't need more).
async function toDpBlob(file) {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  const size = 384;
  const scale = size / Math.min(bitmap.width, bitmap.height);
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = Math.min(w, size * 2);
  canvas.height = Math.min(h, size * 2);
  canvas.getContext("2d").drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();
  return new Promise((res) => canvas.toBlob(res, "image/jpeg", 0.82));
}

function openProfileModal() {
  const p = state.myProfile || {};
  document.getElementById("profile-name-input").value = state.currentUsername || "";
  document.getElementById("profile-bio-input").value = p.bio || "";
  pendingDpFile = null;
  setAvatar(document.getElementById("profile-avatar-preview"), state.currentUsername, p.avatar_url);
  document.getElementById("profile-modal").classList.remove("hidden");
}

async function saveProfile() {
  const username = document.getElementById("profile-name-input").value.trim();
  const bio = document.getElementById("profile-bio-input").value.trim();
  if (!username) {
    showToast("Name can't be empty.");
    return;
  }

  const updates = { username, bio };

  // Upload a new DP first (unique path per upload; the bucket is insert-only).
  if (pendingDpFile) {
    try {
      const blob = await toDpBlob(pendingDpFile);
      const path = `avatars/${state.currentUser.id}_${Date.now()}.jpg`;
      const { error: upErr } = await supabaseClient.storage
        .from("chat-files")
        .upload(path, blob, { contentType: "image/jpeg" });
      if (upErr) throw upErr;
      updates.avatar_url = supabaseClient.storage.from("chat-files").getPublicUrl(path).data.publicUrl;
    } catch {
      showToast("Could not upload the photo.");
      return;
    }
  }

  const { error } = await supabaseClient.from("profiles").update(updates).eq("id", state.currentUser.id);
  if (error) {
    if (/duplicate|unique/i.test(error.message)) showToast(`"${username}" is already taken.`);
    else if (/column/i.test(error.message)) showToast("Run supabase-phase5.sql to enable bio + photo.");
    else showToast("Could not save your profile.");
    return;
  }

  // Keep the auth metadata in sync so future logins pick the new name up.
  await supabaseClient.auth.updateUser({ data: { username } }).catch(() => {});

  state.currentUsername = username;
  await refreshMyProfile();
  document.getElementById("profile-modal").classList.add("hidden");
  showToast("Profile saved ✨", "success");
}

export function initProfile() {
  document.getElementById("rail-profile").addEventListener("click", openProfileModal);
  // The @name at the top of the chat list is a shortcut to the same place.
  document.getElementById("my-profile-name")?.addEventListener("click", openProfileModal);
  document.getElementById("close-profile-modal").addEventListener("click", () => {
    document.getElementById("profile-modal").classList.add("hidden");
  });

  const dpInput = document.getElementById("dp-input");
  document.getElementById("change-dp-btn").addEventListener("click", () => dpInput.click());
  dpInput.addEventListener("change", () => {
    const file = dpInput.files[0];
    dpInput.value = "";
    if (!file || !file.type.startsWith("image/")) return;
    pendingDpFile = file;
    if (pendingDpPreview) URL.revokeObjectURL(pendingDpPreview);
    pendingDpPreview = URL.createObjectURL(file);
    const preview = document.getElementById("profile-avatar-preview");
    preview.innerHTML = "";
    preview.style.background = "var(--surface-2)";
    preview.append(el("img", { src: pendingDpPreview, alt: "" }));
  });

  const saveBtn = document.getElementById("save-profile-btn");
  saveBtn.addEventListener("click", () => withBusy(saveBtn, "Saving…", saveProfile));
}
