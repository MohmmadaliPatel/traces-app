rm -rf dist
mkdir dist
cd dist
cp -r ../.next ./.next
cp -r ../db ./db
cp -r ../qpdf ./qpdf
cp -r ../pdf-signer ./pdf-signer
rm ./db/db.sqlite

mkdir logs
mkdir public
cp ../public/favicon.ico ./public/favicon.ico
cp ../public/logo.png ./public/logo.png
cp ../public/icon.ico ./public/icon.ico

cp ../.env ./.env
cp ../next.config.js ./next.config.js
cp ../package.json ./package.json
cp ../tsconfig.json ./tsconfig.json
cp ../configure.bat ./configure.bat
cp ../start.bat ./start.bat
cp ../traces-conso.exe ./traces-conso.exe

