export interface GenerateCaptchaResponse {
  id: string
  image: string
}

export interface TracesLoginResponse {
  authTokenDto?: {
    accessToken?: string
  }
}
