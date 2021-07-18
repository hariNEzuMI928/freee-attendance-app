const { App } = require("@slack/bolt");
require("dotenv").config();
fetch = require("node-fetch");
const freeeService = require("./freeeService");

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
});

// 作業開始場所
const locations = ["自宅", "会社", "布団の中", "その他の場所"];
const locationOptions = locations.map((location, index) => {
  return {
    text: {
      type: "plain_text",
      text: location,
      emoji: true,
    },
    value: index.toString(),
  };
});

// 業務中、休憩中、業務終了
const slackEmojiStatus = {
  during_work: ":sunny:",
  during_break: ":sushi:",
  after_work: ":crescent_moon:",
};

// 勤怠打刻開始モーダル
app.shortcut("kintai_start_shortcut", async ({ shortcut, ack }) => {
  ack();

  try {
    await app.client.views.open({
      trigger_id: shortcut.trigger_id,
      view: {
        title: {
          type: "plain_text",
          text: "勤怠打刻",
        },
        callback_id: "kintai_start_modal",
        submit: {
          type: "plain_text",
          text: "Submit",
        },
        type: "modal",
        close: {
          type: "plain_text",
          text: "Close",
        },
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: "今日も一日頑張りましょう:relaxed:",
            },
          },
          {
            type: "input",
            element: {
              type: "static_select",
              action_id: "select_location_action",
              placeholder: {
                type: "plain_text",
                text: "Select",
                emoji: true,
              },
              options: locationOptions,
            },
            label: {
              type: "plain_text",
              text: "どこで作業開始しますか？",
              emoji: true,
            },
          },
          {
            type: "input",
            element: {
              type: "conversations_select",
              action_id: "input",
              response_url_enabled: true,
              default_to_current_conversation: true,
            },
            label: {
              type: "plain_text",
              text: "投稿するチャンネル",
            },
          },
        ],
      },
    });
  } catch (err) {
    console.error(err);
  }
});

// 勤怠打刻開始モーダルでのセレクトボックス選択イベント
app.action("select_location_action", async ({ ack }) => {
  await ack();
});

// 勤怠打刻開始モーダルでのデータ送信イベントを処理
app.view("kintai_start_modal", async ({ ack, body, view, client }) => {
  await ack();

  const slackUserId = body.user.id;
  const { profile: profile } = await app.client.users.profile.get({
    user: slackUserId,
  });
  const channelId = body.response_urls[0].channel_id;
  const selectedOption =
    view.state.values[
      Object.keys(view.state.values).filter(
        (value) => view.state.values[value].select_location_action !== undefined
      )[0]
    ].select_location_action.selected_option.value;
  const msg = `${locations[selectedOption]} で業務開始します！`;

  const date = new Date();
  const formattedDate = `${date.getFullYear()}-${(date.getMonth() + 1)
    .toString()
    .padStart(2, "0")}-${date.getDate().toString().padStart(2, "0")}`.replace(
    /\n|\r/g,
    ""
  );

  try {
    await freeeService.postTimeClocks(
      slackUserId,
      freeeService.TIME_CLOCK_TYPE.clock_in.value
    );

    await client.chat.postMessage({
      username: profile.real_name_normalized,
      icon_url: profile.image_48,
      channel: channelId,
      text: msg,
    });

    await client.chat.postMessage({
      channel: slackUserId,
      text: channelId, // ButtonアクションにチャンネルIDを渡す
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: "*" + formattedDate + "* :sunny:",
          },
        },
        {
          type: "actions",
          elements: [
            {
              type: "button",
              text: {
                type: "plain_text",
                emoji: true,
                text: freeeService.TIME_CLOCK_TYPE.break_begin.text,
              },
              style: "primary",
              value: freeeService.TIME_CLOCK_TYPE.break_begin.value,
              action_id: freeeService.TIME_CLOCK_TYPE.break_begin.value,
            },
            {
              type: "button",
              text: {
                type: "plain_text",
                emoji: true,
                text: freeeService.TIME_CLOCK_TYPE.break_end.text,
              },
              value: freeeService.TIME_CLOCK_TYPE.break_end.value,
              action_id: freeeService.TIME_CLOCK_TYPE.break_end.value,
            },
            {
              type: "button",
              text: {
                type: "plain_text",
                emoji: true,
                text: freeeService.TIME_CLOCK_TYPE.clock_out.text,
              },
              style: "danger",
              value: freeeService.TIME_CLOCK_TYPE.clock_out.value,
              action_id: freeeService.TIME_CLOCK_TYPE.clock_out.value,
            },
          ],
        },
      ],
    });

    await changeSlackEmojiStatus(slackEmojiStatus.during_work);
  } catch (err) {
    console.error(err);
  }
});

app.action(
  freeeService.TIME_CLOCK_TYPE.break_begin.value,
  async ({ body, ack, say }) => {
    await ack();

    const actionId = body.actions[0].action_id;
    const slackUserId = body.user.id;
    const channelId = body.message.text;

    try {
      await freeeService.postTimeClocks(
        slackUserId,
        freeeService.TIME_CLOCK_TYPE[actionId].value
      );
      await say(`[打刻] *${freeeService.TIME_CLOCK_TYPE[actionId].text}*`);

      await postTimeClocksMsg(slackUserId, channelId, actionId);

      await changeSlackEmojiStatus(slackEmojiStatus.during_break);
    } catch (err) {
      console.error(err);
    }
  }
);

app.action(
  freeeService.TIME_CLOCK_TYPE.break_end.value,
  async ({ body, ack, say }) => {
    await ack();

    const actionId = body.actions[0].action_id;
    const slackUserId = body.user.id;
    const channelId = body.message.text;

    try {
      await freeeService.postTimeClocks(
        slackUserId,
        freeeService.TIME_CLOCK_TYPE[actionId].value
      );
      await say(`[打刻] *${freeeService.TIME_CLOCK_TYPE[actionId].text}*`);

      await postTimeClocksMsg(slackUserId, channelId, actionId);

      await changeSlackEmojiStatus(slackEmojiStatus.during_work);
    } catch (err) {
      console.error(err);
    }
  }
);

app.action(
  freeeService.TIME_CLOCK_TYPE.clock_out.value,
  async ({ body, ack, say }) => {
    await ack();

    const actionId = body.actions[0].action_id;
    const slackUserId = body.user.id;
    const channelId = body.message.text;

    try {
      await freeeService.postTimeClocks(
        slackUserId,
        freeeService.TIME_CLOCK_TYPE[actionId].value
      );
      await say(`[打刻] *${freeeService.TIME_CLOCK_TYPE[actionId].text}*`);
      await say("今日もお疲れ様でした :star2:");

      await postTimeClocksMsg(slackUserId, channelId, actionId);

      await changeSlackEmojiStatus(slackEmojiStatus.after_work);
    } catch (err) {
      console.error(err);
    }
  }
);

const postTimeClocksMsg = async (slackUserId, channelId, actionId) => {
  try {
    const { profile: profile } = await app.client.users.profile.get({
      user: slackUserId,
    });
    const msg = `${freeeService.TIME_CLOCK_TYPE[actionId].text} します`;

    await app.client.chat.postMessage({
      username: profile.real_name_normalized,
      icon_url: profile.image_48,
      channel: channelId,
      text: msg,
    });

    return Promise.resolve();
  } catch (err) {
    return Promise.reject(err);
  }
};

const changeSlackEmojiStatus = async (status_emoji) => {
  try {
    await app.client.users.profile.set({
      token: process.env.SLACK_USER_TOKEN,
      profile: { status_emoji: status_emoji },
    });

    return Promise.resolve();
  } catch (err) {
    return Promise.reject(err);
  }
};

(async () => {
  // Start your app
  await app.start(process.env.PORT || 3030);

  console.log("⚡️ Bolt app is running!");
})();
