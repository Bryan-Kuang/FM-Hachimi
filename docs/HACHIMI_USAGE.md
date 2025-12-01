# Hachimi Feature Usage Guide

This document describes the redesigned Hachimi (哈基米) feature for the Bilibili Discord Bot.

## 1. Overview

The Hachimi feature is an automated command that searches for "哈基米" videos on Bilibili, filters them based on specific quality criteria, and adds the top results to the bot's playback queue.

## 2. Command Usage

**Command:** `/hachimi`

**Description:** Auto-play 5 Bilibili videos with "哈基米" tag that meet quality criteria.

**Permissions:**
- User must be in a voice channel.
- Bot must have permissions to join and speak in the channel.

## 3. Filtering Logic

The feature uses a smart filtering algorithm to select high-quality or popular videos. A video is selected if it meets **ANY** of the following criteria:

1.  **High Engagement:** Like Rate > 5% (Likes / Views > 0.05)
2.  **High Popularity:** Views > 10,000

The bot fetches search results and selects the **top 5** videos that meet these criteria.

## 4. Technical Implementation

### 4.1 File Structure
- `src/bot/commands/hachimi.js`: Slash command handler.
- `src/utils/bilibiliApi.js`: Core logic for searching and filtering.

### 4.2 Process Flow
1.  User executes `/hachimi`.
2.  Bot validates voice state.
3.  Bot calls `BilibiliAPI.searchHachimiVideos(5)`.
    - API searches for "哈基米" (fetches 50 candidates).
    - API filters candidates using `filterQualityVideos`.
    - Returns top 5 qualified videos.
4.  Bot clears the current queue.
5.  Bot adds the videos to the `PlaylistManager`.
6.  Bot starts playback.

## 5. Configuration

The feature is configured via code constants in `src/utils/bilibiliApi.js` and `src/bot/commands/hachimi.js`.

- **Search Query:** "哈基米"
- **Max Results:** 5 (default)
- **Fetch Limit:** 50 (candidates per search)
- **Quality Thresholds:**
    - Like Rate: 0.05 (5%)
    - Min Views: 10,000

## 6. Troubleshooting

- **No Results Found:** The bot could not find any videos meeting the criteria in the first 50 search results.
- **Extractor Error:** The audio extractor failed to resolve the video URL.
- **Timeout:** The search operation took too long.

## 7. Testing

Unit tests are provided in `tests/bilibili_hachimi.test.js`.

Run tests with:
```bash
npm test tests/bilibili_hachimi.test.js
```
