import { useEffect, useRef, useState, type ChangeEvent } from "react";

import type { StudioProfile, UpsertProfileRequest } from "../../../shared/mmwaveTypes";
import { sortProfiles } from "../../../shared/mmwaveUtils";
import { errorMessage } from "../../../shared/types";
import {
  createMmwaveProfile,
  deleteMmwaveProfile,
  fetchMmwaveProfiles,
  importMmwaveProfiles,
  updateMmwaveProfile
} from "../../mmwaveApi";

export function useMmwaveProfiles(
  selectedDeviceName: string | null,
  setBusyAction: (action: string | null) => void,
  setError: (error: string | null) => void
) {
  const [profiles, setProfiles] = useState<StudioProfile[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);
  const [profileName, setProfileName] = useState("");
  const [profileNotes, setProfileNotes] = useState("");
  const importInputRef = useRef<HTMLInputElement | null>(null);

  const selectedProfile = profiles.find((profile) => profile.id === selectedProfileId) ?? null;

  async function reloadProfiles(preferredId?: string | null) {
    const next = sortProfiles(await fetchMmwaveProfiles());
    setProfiles(next);
    setSelectedProfileId((current) => {
      const keep = preferredId ?? current;
      return keep && next.some((profile) => profile.id === keep) ? keep : next[0]?.id ?? null;
    });
  }

  useEffect(() => {
    reloadProfiles(null).catch((nextError) => {
      setError(errorMessage(nextError));
    });
  }, []);

  useEffect(() => {
    if (selectedProfile) {
      setProfileName(selectedProfile.name);
      setProfileNotes(selectedProfile.notes);
      return;
    }
    if (selectedDeviceName) {
      setProfileName((current) => current || `${selectedDeviceName} tune`);
    }
  }, [selectedDeviceName, selectedProfileId, selectedProfile?.name, selectedProfile?.notes]);

  async function saveProfile(asUpdate: boolean, payload: UpsertProfileRequest) {
    const label = asUpdate ? "update-profile" : "save-profile";
    setBusyAction(label);
    setError(null);
    try {
      const saved =
        asUpdate && selectedProfile
          ? await updateMmwaveProfile(selectedProfile.id, payload)
          : await createMmwaveProfile(payload);
      await reloadProfiles(saved.id);
    } catch (nextError) {
      setError(errorMessage(nextError));
    } finally {
      setBusyAction(null);
    }
  }

  async function removeProfile() {
    if (!selectedProfile) {
      return;
    }
    if (!window.confirm(`Delete profile "${selectedProfile.name}"?`)) {
      return;
    }
    setBusyAction("delete-profile");
    setError(null);
    try {
      await deleteMmwaveProfile(selectedProfile.id);
      setSelectedProfileId(null);
      await reloadProfiles(null);
      if (selectedDeviceName) {
        setProfileName(`${selectedDeviceName} tune`);
        setProfileNotes("");
      }
    } catch (nextError) {
      setError(errorMessage(nextError));
    } finally {
      setBusyAction(null);
    }
  }

  function startNewProfileDraft() {
    setSelectedProfileId(null);
    if (selectedDeviceName) {
      setProfileName(`${selectedDeviceName} tune`);
    } else {
      setProfileName("");
    }
    setProfileNotes("");
  }

  function exportProfile() {
    if (!selectedProfile) {
      return;
    }
    const blob = new Blob([JSON.stringify(selectedProfile, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download =
      `${selectedProfile.name.replace(/[^a-z0-9-_]+/gi, "_").toLowerCase() || "profile"}.json`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }

  async function importProfileFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) {
      return;
    }
    setBusyAction("import-profile");
    setError(null);
    try {
      const raw = await file.text();
      const payload = JSON.parse(raw) as unknown;
      const imported = sortProfiles(await importMmwaveProfiles(payload));
      setProfiles(imported);
      setSelectedProfileId(imported[0]?.id ?? null);
    } catch (nextError) {
      setError(errorMessage(nextError));
    } finally {
      setBusyAction(null);
    }
  }

  return {
    profiles,
    selectedProfile,
    selectedProfileId,
    profileName,
    profileNotes,
    importInputRef,
    setSelectedProfileId,
    setProfileName,
    setProfileNotes,
    reloadProfiles,
    saveProfile,
    removeProfile,
    startNewProfileDraft,
    exportProfile,
    importProfileFile
  };
}
