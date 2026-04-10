export const CHUNK_SIZE            = 64  * 1024         // 64 KB — safe for all browsers
export const BUFFER_HIGH_THRESHOLD = 4   * 1024 * 1024  // pause sending above 4 MB
export const BUFFER_LOW_THRESHOLD  = 1   * 1024 * 1024  // resume sending below 1 MB

export const RTC_CONFIG: RTCConfiguration = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
}
