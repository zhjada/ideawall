const baseController = proxy.require('../controller/BaseController');
const http = proxy.require('../core/Http');
const logger = proxy.require('../core/Logger');
const preferenceModel = proxy.require('../model/PreferenceModel')(proxy.appVar);
const deviceMessage = proxy.require('../message/DeviceMessage')();

var vm = new Vue({
    el: '#app',
    data: function () {
        return {
            loading: true,
            lock: proxy.lock,
            tipReboot: undefined,
            btnLoading: {
                checkUpdate: {
                    bol: false,
                    text: '正在检查...',
                    htext: '检查更新',
                },
                reboot: {
                    bol: false,
                    text: '正在重启...',
                    htext: '重新启动',
                },
                repair: {
                    bol: false,
                    text: '正在修复...',
                    htext: '执行修复',
                },
                clearCache: {
                    bol: false,
                    showDesc: false,
                    text: '正在清理...',
                    htext: '清理缓存',
                },
                openUpdatelog: {
                    bol: false,
                    text: '正在调起...',
                    htext: '版本介绍',
                },
            },
            menuInfoTab: 'common',
            animation: {
                in: 'random',
                out: 'random',
                stay: 'random',
                preview: '',
            },
            preferences: [],//设置列表
        }
    },
    methods: {
        handleInfoTabClick() {
        },
        //常规设置项
        doSetPreference(index, key, nval) {
            top.vm.showLoadingMaster();
            var preference;
            if (!index) {
                preference = this.preferences.filter((item) => {
                    return item.key + '' == key + '';
                })[0];
                preference.value.val = nval;
            } else {
                preference = this.preferences[index];
            }
            console.debug(preference);
            //数据库更新
            preferenceModel.updateById(JSON.parse(JSON.stringify(preference)));//阻止引用指针.
            /**
             * 即时生效
             */
            if (preference.key === 'autoLaunch') {//开机自启动
                this.setAutoLaunch(preference.value.enable);
            }
            if (preference.key === 'hideDock') {//隐藏 Dock
                proxy.ipc.send('ipc_preference_dock', nval);
            }
            if (preference.sync === 2) {//同步到设备桌面
                deviceMessage.syncUpdate();
            }
            if (preference.reboot === 2 && !this.tipReboot.value.val) {//重启提示
                proxy.confirm('系统提示', '此配置项需要重启 ideawall 以生效, 是否立刻重启?', (res) => {
                    if (res === 0) {
                        this.reboot();
                    } else if (res === 2) {
                        this.tipReboot.value.val = true;
                        preferenceModel.updateById(JSON.parse(JSON.stringify(this.tipReboot)));
                        console.debug(this.tipReboot);
                    }
                }, ['重启', '稍后', '不再提醒']);
            }
        },
        //设置开机自启动
        setAutoLaunch(enable) {
            if (enable) {
                proxy.appVar._autoLauncher.enable();
            } else {
                proxy.appVar._autoLauncher.disable();
            }
        },
        //重启
        reboot() {
            var that = this;
            if (!this.btnLoading.reboot.bol) {
                this.btnLoading.reboot.bol = true;
                setTimeout(() => {
                    proxy.remote.app.relaunch();
                    proxy.remote.app.exit(0);
                    that.btnLoading.reboot.bol = false;
                }, 2000);
            }
        },
        //检查更新
        checkUpdate() {
            var that = this;
            if (!this.btnLoading.checkUpdate.bol) {
                this.btnLoading.checkUpdate.bol = true;
                setTimeout(() => {
                    proxy.ipc.send('ipc_update_check');
                    proxy.ipc.removeAllListeners('ipc_app_update_ret');
                    var lastCode = '';
                    proxy.ipc.on('ipc_app_update_ret', (event, obj) => {
                        if (obj.code != lastCode && obj.code != 'downloading') {//非下载进度事件, 防止接收两次的问题.
                            lastCode = obj.code;
                            console.debug('ipc_app_update_ret');
                            console.debug(obj);
                            if (obj.code === 'updateAva') {
                                that.btnLoading.checkUpdate.bol = false;
                                that.btnLoading.checkUpdate.htext = '检测到新更新包';
                                if (proxy.appVar._platform === 'darwin') {
                                    proxy.alert('ideawall 更新提醒', '检测到全新版本, 点击前往下载', (response) => {
                                        if (response === 0) proxy.openExternal(proxy.appVar._updatepageurl);
                                    }, 'info', ['前往下载', '稍后处理']);
                                }
                            } else if (obj.code === 'updateNotAva') {
                                that.btnLoading.checkUpdate.bol = false;
                                that.btnLoading.checkUpdate.htext = '暂无可用更新包';
                            } else if (obj.code === 'downloading') {
                                that.btnLoading.checkUpdate.text = '已下载 ' + obj.perc + '%';
                            } else if (obj.code === 'downloaded') {
                                that.btnLoading.checkUpdate.bol = false;
                                that.btnLoading.checkUpdate.htext = '已下载完成';
                            } else if (obj.code === 'error') {
                                if (proxy.appVar._platform !== 'darwin') {
                                    that.btnLoading.checkUpdate.bol = false;
                                    that.btnLoading.checkUpdate.htext = '暂无可用更新包';
                                }
                            }
                        }
                    });
                }, 2000);
            }
        },
        //修复
        repair() {
            var that = this;
            if (!this.btnLoading.reboot.bol) {
                var message = "警告: 你正在执行系统修复任务";
                var detail = "此动作将清空本地持久化数据库, 且无法回滚. 请确认是否继续执行？ (此过程将在一分钟内完成, 期间你不能进行任何操作, 修复完毕后将自动重启应用。)";
                proxy.confirm(message, detail, (response) => {
                    if (response === 0) {
                        that.btnLoading.repair.bol = true;
                        $('.zxx-pre-repair-tip').css('color', '#F56C6C').text('正在锁定控制面板并停止所有同步策略和设备快照...');
                        //锁定控制面板
                        proxy.ipc.send('ipc_lock', true);
                        //1.关闭快照
                        proxy.ipc.send('ipc_repeat', 'ipc_render_snapscreen_stop');
                        setTimeout(() => {
                            //2.关闭壁纸窗口
                            $('.zxx-pre-repair-tip').css('color', '#F56C6C').text('正在销毁桌面壁纸层...');
                            for (var x in proxy.appVar._wallwindows) {
                                var win = proxy.appVar._wallwindows[x].window;
                                win.close();
                            }
                            setTimeout(() => {
                                $('.zxx-pre-repair-tip').css('color', '#F56C6C').text('正在清空本地日志和缓存...');
                                setTimeout(() => {
                                    proxy.ipc.send('ipc_clean');//清空缓存数据[日志等]
                                    $('.zxx-pre-repair-tip').css('color', '#F56C6C').text('正在清空本地持久化用户数据...');
                                    setTimeout(() => {
                                        //3.清空工作空间数据和缓存. [windows下被占用的话无法删除.]
                                        preferenceModel.clearDatabase();//清空数据库
                                        $('.zxx-pre-repair-tip').css('color', '#F56C6C').text('修复完毕, 最后还有几件小事, 请稍后...');
                                        setTimeout(() => {
                                            // that.btnLoading.repair.bol = false;
                                            proxy.ipc.send('ipc_lock', false);
                                            $('.zxx-pre-repair-tip').css('color', '#F56C6C').text('正在解锁控制面板并请求重新启动 ideawall...');
                                            that.reboot();
                                            //重启之后, 控制面板就是解锁的, 不需要再进行处理.
                                            return true;
                                        }, 4000);
                                    }, 4000);
                                }, 3000);
                            }, 4000);
                        }, 2000);
                    } else {
                        that.btnLoading.repair.bol = false;
                    }
                });
            }
        },
        //清理缓存
        clearCache() {
            this.btnLoading.clearCache.bol = true;
            proxy.ipc.send('ipc_clean', 'onlyCache');
            setTimeout(() => {
                this.btnLoading.clearCache.htext = '清理完毕';
                this.btnLoading.clearCache.bol = false;
                this.btnLoading.clearCache.showDesc = true;
            }, 6000);
        },
        //前往官网
        gotoOffical() {
            proxy.openExternal(proxy.appVar._siteurl);
        },
        //查看版本介绍
        openUpdateLog() {
            this.btnLoading.openUpdatelog.bol = true;
            setTimeout(() => {
                if (proxy.appVar._updatelog && (proxy.appVar._updatelog + '').trim() !== '' && proxy.appVar._updatelog.indexOf('http') === 0) {
                    $$.gotoBbs(proxy.appVar._updatelog);
                } else {
                    proxy.alert('系统提示', '调起失败! 请升级至最新版本或联系我们~');
                }
                this.btnLoading.openUpdatelog.bol = false;
            }, 1000);
        },
        //关于
        openAbout() {
            // proxy.openExternal(proxy.appVar._siteurl);
            proxy.ipc.send('ipc_window_open', 'about');
        },
        //预览动画
        previewAnimate(type) {
            if (type === 'out') {
                this.animation.preview = this.animation.out;
                if (this.animation.preview == 'random') {
                    this.animation.preview = animation.getAnimateOut();
                }

            } else {
                this.animation.preview = this.animation.in;
                if (this.animation.preview == 'random') {
                    this.animation.preview = animation.getAnimateIn();
                }
            }
        }
    },
    created: function () {
        var preferences = preferenceModel.getAll();
        for (var x in preferences) {
            if (preferences[x].explicit === 2) {
                preferences[x].value = JSON.parse(preferences[x].value);
            }
        }
        this.preferences = preferences.sort(function (a, b) {
            return a.sort - b.sort;
        });
    },
    mounted() {
        var that = this;
        var stacpPref = preferenceModel.getByKey('dontshowTipAfter_changePref');
        stacpPref.value = JSON.parse(stacpPref.value);
        this.tipReboot = stacpPref;
        console.debug(this.tipReboot);
        proxy.ipc.on('ipc_lock_req', function (event, swicth) {
            proxy.lock = swicth;
            proxy.appVar._lock = swicth;
            proxy.refreshAppVar();
            that.lock = swicth;
        });
    }
});

window.onload = function () {
    vm.loading = false;
    top.vm.loadingTab = false;
};