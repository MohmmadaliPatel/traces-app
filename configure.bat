@echo off
call npm i -g yarn
call yarn install
call yarn migrate
call yarn generate
call yarn seed

REM Check if .env.production exists
IF EXIST ".env.production" (
  REM Check if SERVER_URL already exists in the file
  findstr /C:"SERVER_URL=" .env.production >nul
  IF ERRORLEVEL 1 (
    echo SERVER_URL="http://65.1.231.249:4000" >> .env.production
    echo Added SERVER_URL to existing .env.production file.
  ) ELSE (
    echo SERVER_URL already exists in .env.production
  )
) ELSE (
  REM Create new .env.production with SERVER_URL
  echo SERVER_URL="http://65.1.231.249:4000" > .env.production
  echo Created new .env.production file.
)
