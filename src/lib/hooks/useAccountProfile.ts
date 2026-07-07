"use client";

import { useCallback, useEffect, useState } from "react";

import { getMe, getUserPreferences, patchMe, putUserPreferences } from "@/lib/api";
import { setRiskProfileCookie } from "@/lib/preference-cookie";
import type { MeResponse, RiskProfile } from "@/types/api";

export type NotificationDigest = "off" | "daily" | "weekly";

export interface UseAccountProfileOptions {
  /** Runs before every profile reload (e.g. reset dependent UI state). */
  onLoadStart?: () => void;
  /** Runs after a successful profile load (e.g. follow-up fetches). */
  onLoadSuccess?: (token: string, isCancelled: () => boolean) => Promise<void> | void;
  /** Runs when the profile load fails (e.g. clear dependent UI state). */
  onLoadFailure?: () => void;
}

export interface AccountProfileState {
  me: MeResponse | null;
  nickname: string;
  setNickname: (value: string) => void;
  riskProfile: RiskProfile;
  setRiskProfile: (value: RiskProfile) => void;
  notificationEmailEnabled: boolean;
  setNotificationEmailEnabled: (value: boolean) => void;
  notificationDigest: NotificationDigest;
  setNotificationDigest: (value: NotificationDigest) => void;
  loadingAccount: boolean;
  savingAccount: boolean;
  message: string | null;
  error: string | null;
  saveProfile: () => Promise<void>;
}

/**
 * Profile + preferences load/save state machine for the account page.
 * Loads `/me` and `/me/preferences` together when a token is available and
 * saves nickname first, then preferences (partial failure keeps the nickname).
 */
export function useAccountProfile(
  accessToken: string | null,
  { onLoadStart, onLoadSuccess, onLoadFailure }: UseAccountProfileOptions = {},
): AccountProfileState {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [nickname, setNickname] = useState("");
  const [riskProfile, setRiskProfile] = useState<RiskProfile>("balanced");
  const [userPreferences, setUserPreferences] = useState<Record<string, unknown>>({});
  const [notificationEmailEnabled, setNotificationEmailEnabled] = useState(false);
  const [notificationDigest, setNotificationDigest] = useState<NotificationDigest>("off");
  const [loadingAccount, setLoadingAccount] = useState(false);
  const [savingAccount, setSavingAccount] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!accessToken) {
      return;
    }

    const token = accessToken;
    let cancelled = false;
    const isCancelled = () => cancelled;
    async function load() {
      setError(null);
      setMessage(null);
      onLoadStart?.();
      setLoadingAccount(true);
      try {
        const [profile, preferences] = await Promise.all([
          getMe(token),
          getUserPreferences(token),
        ]);
        if (cancelled) return;
        const preferenceValues = preferences.preferences;
        const notificationPreferences = readNotificationPreferences(preferenceValues.notifications);
        setMe(profile);
        setNickname(profile.nickname ?? "");
        setUserPreferences(preferenceValues);
        const initialRiskProfile = readRiskProfile(preferenceValues.risk_profile);
        setRiskProfile(initialRiskProfile);
        setRiskProfileCookie(initialRiskProfile);
        setNotificationEmailEnabled(notificationPreferences.emailEnabled);
        setNotificationDigest(notificationPreferences.digest);
      } catch {
        if (!cancelled) {
          setMe(null);
          onLoadFailure?.();
          setError("로그인 상태를 확인하지 못했습니다. 다시 로그인해 주세요.");
        }
        return;
      } finally {
        if (!cancelled) setLoadingAccount(false);
      }

      await onLoadSuccess?.(token, isCancelled);
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [accessToken, onLoadStart, onLoadSuccess, onLoadFailure]);

  const saveProfile = useCallback(async () => {
    if (!accessToken || !me || savingAccount) return;
    setError(null);
    setMessage(null);
    setSavingAccount(true);
    try {
      const updated = await patchMe(accessToken, { nickname: nickname.trim() || null });
      setMe(updated);
      try {
        const preferences = buildUserPreferences(userPreferences, {
          riskProfile,
          notificationEmailEnabled,
          notificationDigest,
        });
        const savedPreferences = await putUserPreferences(accessToken, preferences);
        setUserPreferences(savedPreferences.preferences);
        setRiskProfileCookie(riskProfile);
        setMessage("계정 설정을 저장했습니다.");
      } catch {
        setError("닉네임은 저장됐지만 선호 설정 저장에 실패했습니다.");
      }
    } catch {
      setError("계정 설정 저장에 실패했습니다.");
    } finally {
      setSavingAccount(false);
    }
  }, [
    accessToken,
    me,
    savingAccount,
    nickname,
    userPreferences,
    riskProfile,
    notificationEmailEnabled,
    notificationDigest,
  ]);

  return {
    me,
    nickname,
    setNickname,
    riskProfile,
    setRiskProfile,
    notificationEmailEnabled,
    setNotificationEmailEnabled,
    notificationDigest,
    setNotificationDigest,
    loadingAccount,
    savingAccount,
    message,
    error,
    saveProfile,
  };
}

export function readRiskProfile(value: unknown): RiskProfile {
  if (value === "conservative" || value === "balanced" || value === "aggressive") {
    return value;
  }
  return "balanced";
}

export function readNotificationDigest(value: unknown): NotificationDigest {
  if (value === "daily" || value === "weekly") {
    return value;
  }
  return "off";
}

function readNotificationPreferences(value: unknown) {
  if (!value || typeof value !== "object") {
    return { emailEnabled: false, digest: "off" as NotificationDigest };
  }
  const preferences = value as Record<string, unknown>;
  return {
    emailEnabled: preferences.email_enabled === true,
    digest: readNotificationDigest(preferences.watchlist_digest),
  };
}

function buildUserPreferences(
  current: Record<string, unknown>,
  values: {
    riskProfile: RiskProfile;
    notificationEmailEnabled: boolean;
    notificationDigest: NotificationDigest;
  },
) {
  const currentNotifications =
    current.notifications && typeof current.notifications === "object"
      ? (current.notifications as Record<string, unknown>)
      : {};
  return {
    ...current,
    risk_profile: values.riskProfile,
    notifications: {
      ...currentNotifications,
      email_enabled: values.notificationEmailEnabled,
      watchlist_digest: values.notificationDigest,
    },
  };
}
