FROM node:14.2.0-alpine3.10   
ADD package.json /tmp/package.json
RUN sed -i 's/dl-cdn.alpinelinux.org/mirrors.aliyun.com/g' /etc/apk/repositories \
	&& apk update && apk add yarn \
	&& cd /tmp && yarn \
	&& mkdir -p /opt/app \
	&& cp -a /tmp/node_modules /opt/app/
WORKDIR /opt/app           
ADD . /opt/app
CMD ["yarn", "build"]
EXPOSE 8080