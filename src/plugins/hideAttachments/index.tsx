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
import { ChannelStore, React, useEffect, useRef, useState } from "@webpack/common";

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
    },
    peekView: {
        type: OptionType.BOOLEAN,
        description: "Show a small preview frame of the hidden media",
        default: false,
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

function HiddenMediaAccessory({ message }: { message: Message; }) {
    const [isHovered, setIsHovered] = useState(false);
    const hoverTimeoutRef = useRef<NodeJS.Timeout | null>(null);

    const handleMouseEnter = () => {
        if (hoverTimeoutRef.current) {
            clearTimeout(hoverTimeoutRef.current);
            hoverTimeoutRef.current = null;
        }
        setIsHovered(true);
    };

    const handleMouseLeave = () => {
        if (hoverTimeoutRef.current) {
            clearTimeout(hoverTimeoutRef.current);
        }
        hoverTimeoutRef.current = setTimeout(() => {
            setIsHovered(false);
        }, 200);
    };

    useEffect(() => {
        return () => {
            if (hoverTimeoutRef.current) {
                clearTimeout(hoverTimeoutRef.current);
            }
        };
    }, []);

    const previews: string[] = [];

    if (settings.store.peekView) {
        for (const att of message.attachments) {
            if (att.content_type?.startsWith("image/") || att.filename.match(/\.(png|jpe?g|webp|gif|svg)$/i) || att.width) {
                previews.push(att.proxy_url || att.url);
            }
        }
        for (const embed of message.embeds) {
            if (embed.thumbnail?.url) {
                previews.push(embed.thumbnail.proxyURL || embed.thumbnail.url);
            } else if (embed.image?.url) {
                previews.push(embed.image.proxyURL || embed.image.url);
            }
        }
    }

    return (
        <div
            className={classes("vc-hideAttachments-accessory", !message.content && "vc-hideAttachments-no-content")}
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
        >
            <span className="vc-hideAttachments-text">Media Hidden</span>
            {isHovered && previews.length > 0 && (
                <div className="vc-hideAttachments-popup">
                    {previews.map((url, idx) => (
                        <img
                            key={idx}
                            src={url}
                            className="vc-hideAttachments-popup-image"
                            alt="preview"
                            onClick={() => toggleHide(message.channel_id, message.id)}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}

export default definePlugin({
    name: "HideMedia",
    description: "Hide attachments and embeds for individual messages via hover button",
    tags: ["Chat", "Appearance"],
    authors: [Devs.Ven, Devs.ryu],
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

        return <HiddenMediaAccessory message={message} />;
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
