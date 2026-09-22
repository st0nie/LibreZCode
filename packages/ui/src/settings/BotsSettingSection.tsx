import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button.js";
import { Input } from "@/components/ui/input.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { logger } from "@/logger.js";
import type { BotConfig, BotsStorage, IBotsService, BotProvider } from "@zcode/services";

/**
 * bots(机器人通知)设置页,对齐闭源 3.14.1。
 * 契约: .agents/specs/bots.md
 *
 * 管理 Telegram/Feishu/微信/Webhook/Discord/WeCom 机器人,
 * 配置 bot 的 token/webhookUrl、allowedWorkspaces、replyMode,启用/禁用。
 */

export interface BotsSettingSectionProps {
  service: IBotsService;
  onConnect?: (bot: BotConfig) => void;
}

export function BotsSettingSection({ service, onConnect }: BotsSettingSectionProps) {
  const { intl } = useZCodeIntl();
  const [storage, setStorage] = useState<BotsStorage | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [editing, setEditing] = useState<BotConfig | undefined>(undefined);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const s = await service.load();
      setStorage(s);
      setError(undefined);
    } catch (err) {
      logger.error("[bots] load failed:", err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [service]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const handleSave = useCallback(
    async (bot: BotConfig) => {
      try {
        await service.upsert(bot);
        setEditing(undefined);
        await reload();
      } catch (err) {
        logger.error("[bots] save failed:", err);
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [service, reload],
  );

  const handleRemove = useCallback(
    async (botId: string) => {
      try {
        await service.remove(botId);
        await reload();
      } catch (err) {
        logger.error("[bots] remove failed:", err);
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [service, reload],
  );

  if (loading && !storage) {
    return <div className="text-ui-base text-foreground-subtle">Loading…</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-ui-base font-medium text-foreground">
            {intl.formatMessage({ id: "bots.title" })}
          </div>
          <div className="text-ui-sm text-foreground-subtle mt-1">
            {intl.formatMessage({ id: "bots.description" })}
          </div>
        </div>
        <Button
          onClick={() =>
            setEditing({
              id: crypto.randomUUID(),
              name: "",
              provider: "telegram",
              enabled: true,
              allowedWorkspaces: [],
              allowedCommands: {
                status: true,
                new: true,
                workspace: true,
                model: true,
                thoughtLevel: true,
                reply: true,
              },
              currentOptions: {},
              replyMode: "assistant_changes",
            })
          }
          data-testid="bots-add"
        >
          {intl.formatMessage({ id: "bots.addBot" })}
        </Button>
      </div>

      {error ? <div className="text-ui-sm text-red-500">{error}</div> : null}

      {storage?.bots.map((bot) => (
        <div
          key={bot.id}
          className="flex items-center justify-between rounded-lg border border-border p-4"
        >
          <div className="min-w-0">
            <div className="text-ui-base font-medium text-foreground">
              {bot.displayName || bot.name || bot.id}
            </div>
            <div className="text-ui-sm text-foreground-subtle">{bot.provider}</div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setEditing(bot)}>
              {intl.formatMessage({ id: "bots.saveSecret" })}
            </Button>
            {onConnect ? (
              <Button variant="outline" size="sm" onClick={() => onConnect(bot)}>
                {intl.formatMessage({ id: "bots.bind" })}
              </Button>
            ) : null}
            <Button variant="outline" size="sm" onClick={() => void handleRemove(bot.id)}>
              {intl.formatMessage({ id: "bots.delete" })}
            </Button>
          </div>
        </div>
      ))}

      {editing ? (
        <BotEditDialog bot={editing} onSave={handleSave} onCancel={() => setEditing(undefined)} />
      ) : null}
    </div>
  );
}

function BotEditDialog({
  bot,
  onSave,
  onCancel,
}: {
  bot: BotConfig;
  onSave: (bot: BotConfig) => void;
  onCancel: () => void;
}) {
  const { intl } = useZCodeIntl();
  const [draft, setDraft] = useState<BotConfig>(bot);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-xl">
        <h3 className="text-ui-lg font-semibold text-foreground">
          {intl.formatMessage({ id: "bots.title" })}
        </h3>
        <div className="mt-4 space-y-3">
          <div>
            <label className="mb-1 block text-ui-base text-foreground-subtle">
              {intl.formatMessage({ id: "server.name" })}
            </label>
            <Input
              value={draft.displayName ?? draft.name}
              onChange={(e) =>
                setDraft({ ...draft, displayName: e.target.value, name: e.target.value })
              }
              placeholder={intl.formatMessage({ id: "server.namePlaceholder" })}
            />
          </div>
          {draft.provider === "webhook" ? (
            <div>
              <label className="mb-1 block text-ui-base text-foreground-subtle">
                {intl.formatMessage({ id: "bots.webhookUrl" })}
              </label>
              <Input
                value={draft.webhookUrl ?? ""}
                onChange={(e) => setDraft({ ...draft, webhookUrl: e.target.value })}
                placeholder="https://example.com/webhook"
              />
            </div>
          ) : (
            <div>
              <label className="mb-1 block text-ui-base text-foreground-subtle">
                {intl.formatMessage({ id: "bots.webhookSecret" })}
              </label>
              <Input
                value={draft.credentialRef ?? ""}
                onChange={(e) => setDraft({ ...draft, credentialRef: e.target.value })}
                placeholder={intl.formatMessage({ id: "bots.webhookSecretPlaceholder" })}
              />
            </div>
          )}
        </div>
        <div className="mt-6 flex justify-end gap-3">
          <Button variant="outline" onClick={onCancel}>
            {intl.formatMessage({ id: "common.cancel" })}
          </Button>
          <Button onClick={() => onSave(draft)}>
            {intl.formatMessage({ id: "bots.saveSecret" })}
          </Button>
        </div>
      </div>
    </div>
  );
}
