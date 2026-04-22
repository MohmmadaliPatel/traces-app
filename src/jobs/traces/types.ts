export interface GenerateCaptchaResponse {
  id: string
  image: string
}

export interface TracesLoginResponse {
  authTokenDto?: {
    accessToken?: string
    /** Required for `preauthV2` (`RefreshToken` header). */
    refreshToken?: string
  }
}
