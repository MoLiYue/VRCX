<template>
    <div class="flex flex-col gap-10 py-2">
        <!-- Discord Rich Presence -->
        <SettingsGroup :title="t('view.settings.discord_presence.discord_presence.header')">
            <template #description>
                <p class="m-0">{{ t('view.settings.discord_presence.discord_presence.description') }}</p>
                <p class="m-0 cursor-pointer hover:text-foreground transition-colors" @click="showVRChatConfig">
                    {{ t('view.settings.discord_presence.discord_presence.enable_tooltip') }}
                </p>
            </template>

            <SettingsItem :label="t('view.settings.discord_presence.discord_presence.enable')">
                <Switch
                    :model-value="discordActive"
                    @update:modelValue="
                        setDiscordActive();
                        saveDiscordOption();
                    " />
            </SettingsItem>

            <SettingsItem
                :label="t('view.settings.discord_presence.discord_presence.world_integration')"
                :description="t('view.settings.discord_presence.discord_presence.world_integration_tooltip')">
                <Switch
                    :model-value="discordWorldIntegration"
                    :disabled="!discordActive"
                    @update:modelValue="
                        setDiscordWorldIntegration();
                        saveDiscordOption();
                    " />
            </SettingsItem>

            <SettingsItem :label="t('view.settings.discord_presence.discord_presence.instance_type_player_count')">
                <Switch
                    :model-value="discordInstance"
                    :disabled="!discordActive"
                    @update:modelValue="
                        setDiscordInstance();
                        saveDiscordOption();
                    " />
            </SettingsItem>

            <SettingsItem :label="t('view.settings.discord_presence.discord_presence.show_current_platform')">
                <Switch
                    :model-value="discordShowPlatform"
                    :disabled="!discordActive || !discordInstance"
                    @update:modelValue="
                        setDiscordShowPlatform();
                        saveDiscordOption();
                    " />
            </SettingsItem>

            <SettingsItem :label="t('view.settings.discord_presence.discord_presence.show_details_in_private')">
                <Switch
                    :model-value="!discordHideInvite"
                    :disabled="!discordActive"
                    @update:modelValue="
                        setDiscordHideInvite();
                        saveDiscordOption();
                    " />
            </SettingsItem>

            <SettingsItem :label="t('view.settings.discord_presence.discord_presence.join_button')">
                <Switch
                    :model-value="discordJoinButton"
                    :disabled="!discordActive"
                    @update:modelValue="
                        setDiscordJoinButton();
                        saveDiscordOption();
                    " />
            </SettingsItem>

            <SettingsItem :label="t('view.settings.discord_presence.discord_presence.show_images')">
                <Switch
                    :model-value="!discordHideImage"
                    :disabled="!discordActive"
                    @update:modelValue="
                        setDiscordHideImage();
                        saveDiscordOption();
                    " />
            </SettingsItem>

            <SettingsItem
                :label="t('view.settings.discord_presence.discord_presence.display_world_name_as_discord_status')">
                <Switch
                    :model-value="discordWorldNameAsDiscordStatus"
                    :disabled="!discordActive"
                    @update:modelValue="
                        setDiscordWorldNameAsDiscordStatus();
                        saveDiscordOption();
                    " />
            </SettingsItem>
        </SettingsGroup>

        <!-- Translation API -->
        <SettingsGroup :title="t('view.settings.advanced.advanced.translation_api.header')">
            <SettingsItem
                :label="t('view.settings.advanced.advanced.translation_api.enable')"
                :description="t('view.settings.advanced.advanced.translation_api.enable_tooltip')">
                <Switch
                    :model-value="translationApi"
                    @update:modelValue="changeTranslationAPI('VRCX_translationAPI')" />
            </SettingsItem>

            <SettingsItem :label="t('view.settings.advanced.advanced.translation_api.translation_api_key')">
                <Button size="sm" variant="outline" @click="showTranslationApiDialog">
                    <Languages class="h-4 w-4 mr-1.5" />
                    {{ t('view.settings.advanced.advanced.translation_api.translation_api_key') }}
                </Button>
            </SettingsItem>
        </SettingsGroup>

        <!-- YouTube API -->
        <SettingsGroup :title="t('view.settings.advanced.advanced.youtube_api.header')">
            <SettingsItem
                :label="t('view.settings.advanced.advanced.youtube_api.enable')"
                :description="t('view.settings.advanced.advanced.youtube_api.enable_tooltip')">
                <Switch :model-value="youTubeApi" @update:modelValue="changeYouTubeApi('VRCX_youtubeAPI')" />
            </SettingsItem>

            <SettingsItem :label="t('view.settings.advanced.advanced.youtube_api.youtube_api_key')">
                <Button size="sm" variant="outline" @click="showYouTubeApiDialog">{{
                    t('view.settings.advanced.advanced.youtube_api.youtube_api_key')
                }}</Button>
            </SettingsItem>
        </SettingsGroup>

        <!-- Remote Database -->
        <SettingsGroup :title="t('view.settings.advanced.advanced.remote_database.header')">
            <SettingsItem
                :label="t('view.settings.advanced.advanced.remote_database.enable')"
                :description="t('view.settings.advanced.advanced.remote_database.enable_description')">
                <Switch
                    :model-value="avatarRemoteDatabase"
                    @update:modelValue="setAvatarRemoteDatabase(!avatarRemoteDatabase)" />
            </SettingsItem>

            <SettingsItem :label="t('view.settings.advanced.advanced.remote_database.avatar_database_provider')">
                <Button size="sm" variant="outline" @click="showAvatarProviderDialog">{{
                    t('view.settings.advanced.advanced.remote_database.avatar_database_provider')
                }}</Button>
            </SettingsItem>
        </SettingsGroup>

        <!-- Cloud Sync -->
        <SettingsGroup title="Cloud Sync">
            <SettingsItem
                label="Enable"
                description="Synchronize memos and avatar tags through your self-hosted PostgreSQL sync server.">
                <Switch :model-value="cloudSyncConfig.enabled" @update:modelValue="setCloudSyncEnabled" />
            </SettingsItem>

            <SettingsItem label="Endpoint">
                <Input
                    v-model="cloudSyncConfig.endpoint"
                    class="h-8 w-96 max-w-full font-mono"
                    placeholder="https://moliyue.xyz/vrcx-sync"
                    @change="saveCloudSyncConfig" />
            </SettingsItem>

            <SettingsItem label="Access token">
                <Input
                    v-model="cloudSyncConfig.token"
                    class="h-8 w-96 max-w-full font-mono"
                    type="password"
                    @change="saveCloudSyncConfig" />
            </SettingsItem>

            <SettingsItem label="Device ID">
                <Input :model-value="cloudSyncConfig.deviceId" class="h-8 w-96 max-w-full font-mono" readonly />
            </SettingsItem>

            <SettingsItem label="Last sync">
                <div class="flex flex-wrap items-center gap-2">
                    <Input :model-value="cloudSyncConfig.lastRun || 'Never'" class="h-8 w-56 max-w-full" readonly />
                    <Button size="sm" variant="outline" :disabled="cloudSyncRunning" @click="runCloudSync">
                        <RotateCw class="h-4 w-4 mr-1.5" />
                        Sync now
                    </Button>
                </div>
            </SettingsItem>
        </SettingsGroup>

        <!-- Web Remote -->
        <SettingsGroup :title="t('view.settings.advanced.advanced.web_remote.header')">
            <SettingsItem
                :label="t('view.settings.advanced.advanced.web_remote.enable')"
                :description="t('view.settings.advanced.advanced.web_remote.enable_description')">
                <Switch :model-value="webRemote.enabled" @update:modelValue="setWebRemoteEnabled" />
            </SettingsItem>

            <SettingsItem :label="t('view.settings.advanced.advanced.web_remote.port')">
                <Input
                    v-model.number="webRemote.port"
                    class="h-8 w-28"
                    type="number"
                    min="1024"
                    max="65535"
                    @change="saveWebRemoteConfig" />
            </SettingsItem>

            <SettingsItem :label="t('view.settings.advanced.advanced.web_remote.access_code')">
                <div class="flex flex-wrap items-center gap-2">
                    <Input :model-value="webRemote.token" class="h-8 w-56 font-mono" readonly />
                    <Button
                        size="icon"
                        variant="outline"
                        :title="t('view.settings.advanced.advanced.web_remote.copy')"
                        @click="copyWebRemoteToken">
                        <Copy class="h-4 w-4" />
                    </Button>
                    <Button
                        size="icon"
                        variant="outline"
                        :title="t('view.settings.advanced.advanced.web_remote.regenerate')"
                        @click="regenerateWebRemoteToken">
                        <RotateCw class="h-4 w-4" />
                    </Button>
                </div>
            </SettingsItem>

            <SettingsItem :label="t('view.settings.advanced.advanced.web_remote.urls')">
                <div class="flex flex-col gap-2">
                    <div v-for="url in webRemote.urls" :key="url" class="flex items-center gap-2">
                        <Input :model-value="url" class="h-8 w-72 max-w-full font-mono" readonly />
                        <Button
                            size="icon"
                            variant="outline"
                            :title="t('view.settings.advanced.advanced.web_remote.copy')"
                            @click="copyText(url)">
                            <Smartphone class="h-4 w-4" />
                        </Button>
                    </div>
                </div>
            </SettingsItem>
        </SettingsGroup>

        <TranslationApiDialog v-model:isTranslationApiDialogVisible="isTranslationApiDialogVisible" />
        <YouTubeApiDialog v-model:isYouTubeApiDialogVisible="isYouTubeApiDialogVisible" />
        <AvatarProviderDialog v-model:isAvatarProviderDialogVisible="isAvatarProviderDialogVisible" />
    </div>
</template>

<script setup>
    import { onMounted, reactive, ref } from 'vue';
    import { Copy, Languages, RotateCw, Smartphone } from 'lucide-vue-next';
    import { toast } from 'vue-sonner';
    import { Button } from '@/components/ui/button';
    import { Input } from '@/components/ui/input';
    import { Switch } from '@/components/ui/switch';
    import { storeToRefs } from 'pinia';
    import { useI18n } from 'vue-i18n';

    import {
        useAdvancedSettingsStore,
        useAvatarProviderStore,
        useDiscordPresenceSettingsStore,
        useGameLogStore,
        useNotificationStore,
        useUserStore,
        useVrStore
    } from '@/stores';

    import { cloudSync } from '@/services/cloudSync';
    import AvatarProviderDialog from '../../dialogs/AvatarProviderDialog.vue';
    import TranslationApiDialog from '../../dialogs/TranslationApiDialog.vue';
    import YouTubeApiDialog from '../../dialogs/YouTubeApiDialog.vue';
    import SettingsGroup from '../SettingsGroup.vue';
    import SettingsItem from '../SettingsItem.vue';

    const { t } = useI18n();

    const advancedSettingsStore = useAdvancedSettingsStore();
    const gameLogStore = useGameLogStore();
    const notificationStore = useNotificationStore();
    const { updateVRLastLocation, updateOpenVR } = useVrStore();

    const {
        setDiscordActive,
        setDiscordInstance,
        setDiscordHideInvite,
        setDiscordJoinButton,
        setDiscordHideImage,
        setDiscordShowPlatform,
        setDiscordWorldIntegration,
        setDiscordWorldNameAsDiscordStatus,
        saveDiscordOption
    } = useDiscordPresenceSettingsStore();

    const {
        discordActive,
        discordInstance,
        discordHideInvite,
        discordJoinButton,
        discordHideImage,
        discordShowPlatform,
        discordWorldIntegration,
        discordWorldNameAsDiscordStatus
    } = storeToRefs(useDiscordPresenceSettingsStore());

    const { showVRChatConfig } = advancedSettingsStore;

    const { avatarRemoteDatabase, youTubeApi, translationApi } = storeToRefs(advancedSettingsStore);
    const { currentUser } = storeToRefs(useUserStore());

    const { setAvatarRemoteDatabase } = advancedSettingsStore;

    const { isAvatarProviderDialogVisible } = storeToRefs(useAvatarProviderStore());
    const { showAvatarProviderDialog } = useAvatarProviderStore();

    const isYouTubeApiDialogVisible = ref(false);
    const isTranslationApiDialogVisible = ref(false);
    const webRemote = reactive({
        enabled: false,
        running: false,
        port: 23590,
        token: '',
        urls: []
    });
    const cloudSyncConfig = reactive({
        enabled: false,
        endpoint: '',
        token: '',
        deviceId: '',
        lastRun: '',
        cursor: 0
    });
    const cloudSyncRunning = ref(false);

    onMounted(() => {
        loadWebRemoteConfig();
        loadCloudSyncConfig();
    });

    /**
     *
     */
    function showYouTubeApiDialog() {
        isYouTubeApiDialogVisible.value = true;
    }

    /**
     *
     */
    function showTranslationApiDialog() {
        isTranslationApiDialogVisible.value = true;
    }

    /**
     *
     * @param configKey
     */
    async function changeYouTubeApi(configKey = '') {
        if (configKey === 'VRCX_youtubeAPI') {
            advancedSettingsStore.setYouTubeApi();
        }
        updateVRLastLocation();
        updateOpenVR();
    }

    /**
     *
     * @param configKey
     */
    async function changeTranslationAPI(configKey = '') {
        if (configKey === 'VRCX_translationAPI') {
            advancedSettingsStore.setTranslationApi();
        }
    }

    async function loadWebRemoteConfig() {
        try {
            applyWebRemoteConfig(JSON.parse(await AppApi.GetRemoteAccessConfig()));
        } catch (err) {
            console.error('Failed to load web remote config:', err);
        }
    }

    async function setWebRemoteEnabled(enabled) {
        webRemote.enabled = enabled;
        await saveWebRemoteConfig();
    }

    async function saveWebRemoteConfig() {
        try {
            const port = Number(webRemote.port) || 23590;
            applyWebRemoteConfig(
                JSON.parse(await AppApi.SetRemoteAccessConfig(webRemote.enabled, port))
            );
        } catch (err) {
            console.error('Failed to save web remote config:', err);
        }
    }

    async function regenerateWebRemoteToken() {
        try {
            applyWebRemoteConfig(JSON.parse(await AppApi.RegenerateRemoteAccessToken()));
        } catch (err) {
            console.error('Failed to regenerate web remote token:', err);
        }
    }

    function copyWebRemoteToken() {
        copyText(webRemote.token);
    }

    function copyText(text) {
        navigator.clipboard?.writeText(text).catch(() => {});
    }

    function applyWebRemoteConfig(config) {
        webRemote.enabled = Boolean(config?.enabled);
        webRemote.running = Boolean(config?.running);
        webRemote.port = Number(config?.port) || 23590;
        webRemote.token = config?.token || '';
        webRemote.urls = Array.isArray(config?.urls) ? config.urls : [];
    }

    async function loadCloudSyncConfig() {
        try {
            Object.assign(cloudSyncConfig, await cloudSync.getConfig());
            updateCloudSyncAutoTimer();
        } catch (err) {
            console.error('Failed to load cloud sync config:', err);
        }
    }

    async function setCloudSyncEnabled(enabled) {
        cloudSyncConfig.enabled = enabled;
        await saveCloudSyncConfig();
    }

    async function saveCloudSyncConfig() {
        try {
            await cloudSync.setConfig(cloudSyncConfig);
            updateCloudSyncAutoTimer();
        } catch (err) {
            console.error('Failed to save cloud sync config:', err);
            toast.error(`Failed to save cloud sync config: ${err.message}`);
        }
    }

    function updateCloudSyncAutoTimer() {
        if (!cloudSyncConfig.enabled || !currentUser.value?.id) {
            cloudSync.stopAutoSync();
            return;
        }
        cloudSync.startAutoSync(currentUser.value.id, {
            onSynced: refreshSyncedViews,
            onError(err) {
                toast.error(`Cloud sync failed: ${err.message}`);
            }
        });
    }

    async function refreshSyncedViews() {
        await Promise.allSettled([
            gameLogStore.gameLogTableLookup(),
            gameLogStore.loadSessionsSegments(),
            notificationStore.initNotifications()
        ]);
        await loadCloudSyncConfig();
    }

    async function runCloudSync() {
        try {
            await saveCloudSyncConfig();
            cloudSyncRunning.value = true;
            const result = await cloudSync.sync(currentUser.value?.id || '');
            await refreshSyncedViews();
            updateCloudSyncAutoTimer();
            toast.success(
                `Sync complete: pulled ${result.pulled}, applied ${result.applied}, pushed ${result.pushed}`
            );
        } catch (err) {
            console.error('Cloud sync failed:', err);
            toast.error(`Cloud sync failed: ${err.message}`);
        } finally {
            cloudSyncRunning.value = false;
        }
    }
</script>
