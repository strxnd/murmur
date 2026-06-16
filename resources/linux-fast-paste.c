#define _POSIX_C_SOURCE 199309L

#include <errno.h>
#include <fcntl.h>
#include <linux/input.h>
#include <linux/uinput.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/ioctl.h>
#include <time.h>
#include <unistd.h>

struct shortcut {
  int keys[4];
  int count;
};

static int emit_event(int fd, int type, int code, int value) {
  struct input_event event;
  memset(&event, 0, sizeof(event));
  event.type = type;
  event.code = code;
  event.value = value;
  return write(fd, &event, sizeof(event)) == sizeof(event) ? 0 : -1;
}

static int sync_events(int fd) {
  return emit_event(fd, EV_SYN, SYN_REPORT, 0);
}

static int press_key(int fd, int code) {
  if (emit_event(fd, EV_KEY, code, 1) != 0) return -1;
  return sync_events(fd);
}

static int release_key(int fd, int code) {
  if (emit_event(fd, EV_KEY, code, 0) != 0) return -1;
  return sync_events(fd);
}

static int configure_key(int fd, int code) {
  return ioctl(fd, UI_SET_KEYBIT, code);
}

static void sleep_micros(long microseconds) {
  struct timespec duration;
  duration.tv_sec = microseconds / 1000000;
  duration.tv_nsec = (microseconds % 1000000) * 1000;
  nanosleep(&duration, NULL);
}

static int open_uinput(void) {
  int fd = open("/dev/uinput", O_WRONLY | O_NONBLOCK);
  if (fd < 0) return -1;

  if (ioctl(fd, UI_SET_EVBIT, EV_KEY) < 0 || ioctl(fd, UI_SET_EVBIT, EV_SYN) < 0) {
    close(fd);
    return -1;
  }

  int keys[] = { KEY_LEFTCTRL, KEY_LEFTSHIFT, KEY_C, KEY_V, KEY_INSERT };
  for (size_t i = 0; i < sizeof(keys) / sizeof(keys[0]); i++) {
    if (configure_key(fd, keys[i]) < 0) {
      close(fd);
      return -1;
    }
  }

  struct uinput_setup setup;
  memset(&setup, 0, sizeof(setup));
  snprintf(setup.name, UINPUT_MAX_NAME_SIZE, "Murmur Linux Text Automation");
  setup.id.bustype = BUS_USB;
  setup.id.vendor = 0x1209;
  setup.id.product = 0x6d75;
  setup.id.version = 1;

  if (ioctl(fd, UI_DEV_SETUP, &setup) < 0 || ioctl(fd, UI_DEV_CREATE) < 0) {
    close(fd);
    return -1;
  }

  sleep_micros(150000);
  return fd;
}

static int send_shortcut(int fd, struct shortcut shortcut) {
  for (int i = 0; i < shortcut.count; i++) {
    if (press_key(fd, shortcut.keys[i]) != 0) return -1;
    sleep_micros(12000);
  }

  for (int i = shortcut.count - 1; i >= 0; i--) {
    if (release_key(fd, shortcut.keys[i]) != 0) return -1;
    sleep_micros(12000);
  }

  return 0;
}

static int parse_shortcut(const char *name, struct shortcut *shortcut) {
  memset(shortcut, 0, sizeof(*shortcut));

  if (strcmp(name, "ctrl-v") == 0) {
    shortcut->keys[0] = KEY_LEFTCTRL;
    shortcut->keys[1] = KEY_V;
    shortcut->count = 2;
    return 0;
  }
  if (strcmp(name, "ctrl-shift-v") == 0) {
    shortcut->keys[0] = KEY_LEFTCTRL;
    shortcut->keys[1] = KEY_LEFTSHIFT;
    shortcut->keys[2] = KEY_V;
    shortcut->count = 3;
    return 0;
  }
  if (strcmp(name, "shift-insert") == 0) {
    shortcut->keys[0] = KEY_LEFTSHIFT;
    shortcut->keys[1] = KEY_INSERT;
    shortcut->count = 2;
    return 0;
  }
  if (strcmp(name, "ctrl-c") == 0) {
    shortcut->keys[0] = KEY_LEFTCTRL;
    shortcut->keys[1] = KEY_C;
    shortcut->count = 2;
    return 0;
  }
  if (strcmp(name, "ctrl-shift-c") == 0) {
    shortcut->keys[0] = KEY_LEFTCTRL;
    shortcut->keys[1] = KEY_LEFTSHIFT;
    shortcut->keys[2] = KEY_C;
    shortcut->count = 3;
    return 0;
  }

  return -1;
}

static const char *shortcut_arg(int argc, char **argv) {
  for (int i = 1; i < argc - 1; i++) {
    if (strcmp(argv[i], "--shortcut") == 0) return argv[i + 1];
  }
  return NULL;
}

int main(int argc, char **argv) {
  const char *shortcut_name = shortcut_arg(argc, argv);
  struct shortcut shortcut;

  if (!shortcut_name || parse_shortcut(shortcut_name, &shortcut) != 0) {
    fprintf(stderr, "Usage: %s --shortcut ctrl-v|ctrl-shift-v|shift-insert|ctrl-c|ctrl-shift-c\n", argv[0]);
    return 2;
  }

  int fd = open_uinput();
  if (fd < 0) {
    fprintf(stderr, "Unable to open /dev/uinput: %s\n", strerror(errno));
    return 1;
  }

  int result = send_shortcut(fd, shortcut);
  ioctl(fd, UI_DEV_DESTROY);
  close(fd);

  if (result != 0) {
    fprintf(stderr, "Unable to emit shortcut: %s\n", strerror(errno));
    return 1;
  }

  return 0;
}
