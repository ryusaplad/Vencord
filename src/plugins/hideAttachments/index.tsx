/*
 * Vencord, a modification for Discord's desktop app
 * Copyright (c) 2022 Vendicated and contributors
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/

import "./styles.css";

import { ChatBarButton, ChatBarButtonFactory } from "@api/ChatButtons";
import { get, set } from "@api/DataStore";
import { updateMessage } from "@api/MessageUpdater";
import { definePluginSettings } from "@api/Settings";
import { ImageInvisible, ImageVisible } from "@components/Icons";
import { Devs } from "@utils/constants";
import { classes } from "@utils/misc";
import definePlugin, { OptionType } from "@utils/types";
import { Message } from "@vencord/discord-types";
import { ChannelStore } from "@webpack/common";

const KEY = "HideAttachments_HiddenIds";

const settings = definePluginSettings({
    autoHide: {
        type: OptionType.BOOLEAN,
        description: "Automatically hide all media in messages",
        default: false,
    },
    showIcon: {
        type: OptionType.BOOLEAN,
        description: "Show a button in the chat bar to toggle auto hide media",
        default: false,
        restartNeeded: true,
    }
});

let hiddenMessages = new Set<string>();

async function getHiddenMessages() {
    hiddenMessages = await get(KEY) ?? new Set();
    return hiddenMessages;
}

const saveHiddenMessages = (ids: Set<string>) => set(KEY, ids);

const hasMedia = (msg: Message) => msg.attachments.length > 0 || msg.embeds.length > 0 || msg.stickerItems.length > 0;

async function toggleHide(channelId: string, messageId: string) {
    const ids = await getHiddenMessages();
    if (!ids.delete(messageId))
        ids.add(messageId);

    await saveHiddenMessages(ids);
    updateMessage(channelId, messageId);
}

const AutoHideMediaToggle: ChatBarButtonFactory = ({ isMainChat }) => {
    const { autoHide, showIcon } = settings.use(["autoHide", "showIcon"]);
    const toggle = () => settings.store.autoHide = !settings.store.autoHide;

    if (!isMainChat || !showIcon) return null;

    return (
        <ChatBarButton
            tooltip={autoHide ? "Disable Auto Hide Media" : "Enable Auto Hide Media"}
            onClick={toggle}
        >
            {autoHide ? <ImageInvisible width={20} height={20} /> : <ImageVisible width={20} height={20} />}
        </ChatBarButton>
    );
};

export default definePlugin({
    name: "HideMedia",
    description: "Hide attachments and embeds for individual messages via hover button",
    tags: ["Chat", "Appearance"],
    authors: [Devs.Ven],
    dependencies: ["MessageUpdaterAPI"],
    settings,

    chatBarButton: {
        icon: ImageInvisible,
        render: AutoHideMediaToggle
    },

    patches: [{
        find: "this.renderAttachments(",
        replacement: {
            match: /(?<=\i=)this\.render(?:Attachments|Embeds|StickersAccessories)\((\i)\)/g,
            replace: "$self.shouldHide($1?.id)?null:$&"
        }
    }],

    messagePopoverButton: {
        icon: ImageInvisible,
        render(msg) {
            if (!hasMedia(msg) && !msg.messageSnapshots.some(s => hasMedia(s.message))) return null;

            const isManuallyHidden = hiddenMessages.has(msg.id);
            const isHidden = settings.store.autoHide ? !isManuallyHidden : isManuallyHidden;

            return {
                label: isHidden ? "Show Media" : "Hide Media",
                icon: isHidden ? ImageVisible : ImageInvisible,
                message: msg,
                channel: ChannelStore.getChannel(msg.channel_id),
                onClick: () => toggleHide(msg.channel_id, msg.id)
            };
        },
    },

    renderMessageAccessory({ message }) {
        if (!this.shouldHide(message.id)) return null;
        if (!hasMedia(message)) return null;

        return (
            <span className={classes("vc-hideAttachments-accessory", !message.content && "vc-hideAttachments-no-content")}>
                Media Hidden
            </span>
        );
    },

    async start() {
        await getHiddenMessages();
    },

    stop() {
        hiddenMessages.clear();
    },

    shouldHide(messageId: string) {
        const isManuallyHidden = hiddenMessages.has(messageId);
        return settings.store.autoHide ? !isManuallyHidden : isManuallyHidden;
    },
});
