import type { RoomTheme } from '@focusspace/shared';

export const themes = {
  rain: {
    name: '窗边雨天',
    description: '雨落窗沿，灰蓝天光与鼠尾草绿。',
    sound: 'rain',
    background: '#e0e7e5',
    wall: '#d1dcda',
    side: '#bdccc8',
    window: '#89a9b5',
    rug: '#8da8a0',
    desk: '#ceb691',
    light: '#d5e8ee',
    intensity: 2.1,
  },
  night: {
    name: '暖灯夜读',
    description: '窗外夜色，让暖灯照着手边这一页。',
    sound: 'fire',
    background: '#d6cabc',
    wall: '#b7acaa',
    side: '#9d9292',
    window: '#354b64',
    rug: '#a29186',
    desk: '#cba175',
    light: '#ffd195',
    intensity: 1.3,
  },
  library: {
    name: '明亮图书馆',
    description: '浅木书架，日光洒满安静的长桌。',
    sound: 'birds',
    background: '#eeeddf',
    wall: '#f0ecdb',
    side: '#dedcc8',
    window: '#c6dfdb',
    rug: '#b3bca0',
    desk: '#dec6a0',
    light: '#fff5da',
    intensity: 2.7,
  },
} satisfies Record<
  RoomTheme,
  {
    name: string;
    description: string;
    sound: string;
    background: string;
    wall: string;
    side: string;
    window: string;
    rug: string;
    desk: string;
    light: string;
    intensity: number;
  }
>;
