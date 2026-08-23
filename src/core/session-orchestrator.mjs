import { MeetronError } from "./errors.mjs";

export class SessionOrchestrator {
  constructor({
    normalizeMeeting,
    getProvider,
    getCurrentState,
    getAudioStatus,
    createState,
    launch,
    cancelLaunch,
    getMeetingStatus,
    setMicrophone,
    stopVoice,
    leaveMeeting,
    restoreAudio,
    persistStopped,
  }) {
    this.dependencies = {
      normalizeMeeting,
      getProvider,
      getCurrentState,
      getAudioStatus,
      createState,
      launch,
      cancelLaunch,
      getMeetingStatus,
      setMicrophone,
      stopVoice,
      leaveMeeting,
      restoreAudio,
      persistStopped,
    };
  }

  validateMeeting(value) {
    const meeting = this.dependencies.normalizeMeeting(value);
    const provider = this.dependencies.getProvider(meeting.providerId);
    return {
      valid: true,
      providerId: meeting.providerId,
      providerLabel: provider.label,
      displayUrl: meeting.displayUrl,
      containsSecret: meeting.containsSecret === true,
      capabilities: provider.capabilities,
    };
  }

  async start({ meetingUrl }) {
    const current = this.dependencies.getCurrentState();
    if (current?.status === "starting" || current?.status === "running") {
      throw new MeetronError("SESSION_ALREADY_RUNNING", "別の会議起動処理が進行中です");
    }
    const meeting = this.dependencies.normalizeMeeting(meetingUrl);
    const audio = await this.dependencies.getAudioStatus();
    const state = this.dependencies.createState({
      meeting,
      audioBackendId: audio.backend || "custom",
    });
    return this.dependencies.launch({ meeting, state });
  }

  async stop() {
    const warnings = [];
    const safely = async (fallback, warning, operation) => {
      try {
        return await operation();
      } catch (error) {
        warnings.push(`${warning}: ${error.message}`);
        return fallback;
      }
    };

    const launchCancellation = await safely(
      { cancelled: false, alreadyStopped: true },
      "起動中の処理を停止できませんでした",
      this.dependencies.cancelLaunch,
    );
    const meetingStatus = await safely(
      { connection: "not-running", microphone: "unavailable" },
      "GPT参加者の状態を確認できませんでした",
      this.dependencies.getMeetingStatus,
    );
    const microphone = meetingStatus.connection === "joined" && meetingStatus.microphone === "unmuted"
      ? await safely(
        { muted: false, alreadyMuted: false },
        "GPT参加者をミュートできませんでした",
        async () => {
          const result = await this.dependencies.setMicrophone({ state: "muted" });
          return { muted: result.verified === true, alreadyMuted: false };
        },
      )
      : { muted: false, alreadyMuted: meetingStatus.microphone === "muted" };
    const voice = await safely(
      { stopped: false, alreadyStopped: true },
      "ChatGPT Voiceを停止できませんでした",
      this.dependencies.stopVoice,
    );
    const meeting = await safely(
      { left: false, alreadyLeft: true, tabClosed: false },
      "GPT参加者を会議から退出させられませんでした",
      this.dependencies.leaveMeeting,
    );
    const audio = await this.dependencies.restoreAudio();
    await this.dependencies.persistStopped?.();

    return {
      stopped: true,
      launchCancellation,
      microphone,
      voice,
      meeting,
      meet: meeting,
      audio,
      warnings,
    };
  }
}

export async function runSessionLaunchPipeline({ provider, operations }) {
  let audioConfigured = false;
  let participantBrowserStarted = false;
  try {
    await operations.installControlUi();
    await operations.configureAudio();
    audioConfigured = true;
    await operations.startVoice();
    participantBrowserStarted = true;
    await operations.prepareParticipant();
    if (provider.capabilities.postJoinMicrophone === "unmuted") {
      await operations.setPostJoinMicrophone("unmuted");
    }
    return {
      providerId: provider.id,
      providerLabel: provider.label,
      postJoinMicrophone: provider.capabilities.postJoinMicrophone,
    };
  } catch (error) {
    if (participantBrowserStarted) {
      await operations.closeParticipantBrowser().catch(() => {});
    }
    if (audioConfigured) {
      await operations.restoreAudio().catch(() => {});
    }
    throw error;
  }
}
